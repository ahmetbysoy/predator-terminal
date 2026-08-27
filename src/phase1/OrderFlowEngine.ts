/**
 * PREDATOR TERMINAL - FAZ 1: OrderFlowEngine
 * ==============================================
 * Yapısal veri (isBuyerMaker) ile trade tarafı belirleme.
 * Regex YASAK. Sadece side flag.
 *
 * Dedektörler:
 * - Whale: Tek trade ≥ eşik, cooldown korumalı
 * - Sweep: Pencere içinde N+ print, toplam ≥ eşik×multiplier
 * - Absorption: Yüksek delta + düşük fiyat hareketi
 * - Delta Burst: CVD eğimi ≥ eşik×multiplier
 * - Spoof: Eşik üstü seviye silinmiş/daralmış
 * - CVD: Kümülatif delta + slope hesabı
 */

import {
  TradeEvent, TradeSide, CVDPoint, CVDSnapshot,
  FlowEvent, FlowEventType,
  OrderFlowConfig, OrderFlowEvents,
  DEFAULT_ORDER_FLOW_CONFIG, EventHandler,
} from "../shared/types";

// ─────────────────────────────────────────────
// RING BUFFER (GC-Free Trade Storage)
// ─────────────────────────────────────────────

class TradeRingBuffer {
  private readonly buffer: TradeEvent[];
  private head: number = 0;
  private _size: number = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  public push(event: TradeEvent): void {
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  public get size(): number { return this._size; }

  /**
   * Son N trade'i döner (en yeni → en eski sıralı).
   * GC: Her çağrıda yeni array oluşturur ama N küçük tutulur.
   */
  public getLatest(count: number): TradeEvent[] {
    const n = Math.min(count, this._size);
    const result: TradeEvent[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      result[i] = this.buffer[idx];
    }
    return result;
  }

  /**
   * Belirli bir zaman aralığındaki trade'leri döner.
   */
  public getByTimeRange(startMs: number, endMs: number): TradeEvent[] {
    const result: TradeEvent[] = [];
    for (let i = 0; i < this._size; i++) {
      const idx = (this.head - 1 - i + this.capacity) % this.capacity;
      const event = this.buffer[idx];
      if (event.timestamp < startMs) break; // Ring buffer sıralı, erken çık
      if (event.timestamp >= startMs && event.timestamp <= endMs) {
        result.push(event);
      }
    }
    return result;
  }

  public clear(): void {
    this.head = 0;
    this._size = 0;
  }
}

// ─────────────────────────────────────────────
// ORDER FLOW ENGINE
// ─────────────────────────────────────────────

export class OrderFlowEngine {
  private readonly config: OrderFlowConfig;
  private readonly trades: TradeRingBuffer;
  private readonly cvdPoints: CVDPoint[] = [];
  private readonly handlers: Map<keyof OrderFlowEvents, Set<EventHandler<unknown>>> = new Map();

  private currentCVD: number = 0;
  private lastWhaleTimestamp: number = 0;
  private symbol: string = "";

  /** Spoof tracking: price → { firstSeen, initialQty } */
  private readonly spoofTracker: Map<number, { firstSeen: number; initialQty: number }> = new Map();

  constructor(config?: Partial<OrderFlowConfig>) {
    this.config = { ...DEFAULT_ORDER_FLOW_CONFIG, ...config };
    this.trades = new TradeRingBuffer(this.config.maxTradeBufferSize);
  }

  /**
   * Ana giriş noktası: Her aggTrade event'i burada işlenir.
   *
   * @param isBuyerMaker — Binance structural flag.
   *   true  = alıcı maker (satıcı taker) → SELL pressure
   *   false = satıcı maker (alıcı taker) → BUY pressure
   *   Regex YASAK. Sadece bu flag kullanılır.
   */
  public processTrade(
    symbol: string,
    price: number,
    quantity: number,
    isBuyerMaker: boolean,
    timestamp: number
  ): TradeEvent {
    this.symbol = symbol.toUpperCase();
    const notional = price * quantity;

    // ── DÜZELTME #5 (Orijinal): Yapısal side belirleme ──
    // isBuyerMaker = true → Satıcı agresif → SELL
    // isBuyerMaker = false → Alıcı agresif → BUY
    const side: TradeSide = isBuyerMaker ? "sell" : "buy";

    // ── CVD güncelle ──
    const delta = side === "buy" ? notional : -notional;
    this.currentCVD += delta;

    // ── CVD point ekle (1 saniyede max 1 point — throttle) ──
    const lastPoint = this.cvdPoints.length > 0 ? this.cvdPoints[this.cvdPoints.length - 1] : null;
    if (!lastPoint || timestamp - lastPoint.timestamp >= 1000) {
      this.cvdPoints.push({ timestamp, cvd: this.currentCVD, delta });
      // ── CVD pencere dışını temizle ──
      this.pruneCVDPoints(timestamp);
    } else {
      // Son point'i güncelle (accumulate)
      (lastPoint as { cvd: number }).cvd = this.currentCVD;
      (lastPoint as { delta: number }).delta += delta;
    }

    // ── Trade event oluştur ──
    const isWhale = notional >= this.config.whaleThresholdNotional;
    const trade: TradeEvent = {
      symbol: this.symbol, price, quantity, notional, side, timestamp,
      isWhale, isAbsorption: false, isSweep: false, // Sonradan güncellenir
    };

    this.trades.push(trade);

    // ── Emit base trade ──
    this.emit("trade", trade);

    // ── Dedektörleri çalıştır ──
    this.detectWhale(trade);
    this.detectSweep(trade);
    this.detectAbsorption(timestamp);
    this.detectDeltaBurst(timestamp);

    return trade;
  }

  /**
   * Spoof tespiti: Depth update geldiğinde çağrılır.
   * Büyük seviye kaybolduysa veya %68'den fazla daraldıysa spoof.
   *
   * @param price - Fiyat seviyesi
   * @param currentQty - Şu anki miktar
   * @param previousQty - Önceki miktar
   * @param timestamp - Event zamanı
   */
  public checkSpoof(
    price: number,
    currentQty: number,
    previousQty: number,
    timestamp: number
  ): FlowEvent | null {
    const currentNotional = price * currentQty;
    const previousNotional = price * previousQty;

    // ── YENİ SEVİYE TAKİBİ: Büyük seviye belirdi ──
    if (currentQty > 0 && currentNotional >= this.config.whaleThresholdNotional) {
      if (!this.spoofTracker.has(price)) {
        this.spoofTracker.set(price, { firstSeen: timestamp, initialQty: currentQty });
      }
    }

    // ── SEVİYE KAYBOLDU: Önceki büyük seviye silindi ──
    if (currentQty === 0 && previousQty > 0 && previousNotional >= this.config.whaleThresholdNotional) {
      const tracked = this.spoofTracker.get(price);
      if (tracked && timestamp - tracked.firstSeen < this.config.spoofLifetimeMs) {
        this.spoofTracker.delete(price);
        const event = this.buildFlowEvent(
          FlowEventType.SPOOF, null, price, previousNotional, timestamp,
          `Level removed: $${this.formatNotional(previousNotional)} after ${((timestamp - tracked.firstSeen) / 1000).toFixed(1)}s`
        );
        this.emit("flowEvent", event);
        this.emit("spoofDetected", event);
        return event;
      }
      // Tracked değilse bile spoof olabilir (ilk görünmeden silinmiş)
      this.spoofTracker.delete(price);
      return null;
    }

    // ── SEVİYE DARALDI: Büyük seviye %68+ küçüldü ──
    if (currentQty > 0 && previousQty > 0 && previousNotional >= this.config.whaleThresholdNotional) {
      const shrinkRatio = currentQty / previousQty;
      if (shrinkRatio < this.config.spoofShrinkPct) {
        const tracked = this.spoofTracker.get(price);
        const lifetime = tracked ? timestamp - tracked.firstSeen : 0;
        if (lifetime < this.config.spoofLifetimeMs) {
          this.spoofTracker.delete(price);
          const event = this.buildFlowEvent(
            FlowEventType.SPOOF, null, price, previousNotional, timestamp,
            `Level shrunk ${(shrinkRatio * 100).toFixed(0)}%: $${this.formatNotional(previousNotional)}`
          );
          this.emit("flowEvent", event);
          this.emit("spoofDetected", event);
          return event;
        }
      }
    }

    return null;
  }

  /** Son 60 saniyedeki spoof sayısı */
  public getSpoofCount(windowMs: number = 60000): number {
    const now = Date.now();
    let count = 0;
    // SpoofTracker'daki aktif entry'leri say
    for (const [, tracked] of this.spoofTracker) {
      if (now - tracked.firstSeen < windowMs) count++;
    }
    return count;
  }

  // ── CVD API ──

  public getCVDSnapshot(): CVDSnapshot {
    const now = Date.now();
    return {
      currentCVD: this.currentCVD,
      slope1m: this.calculateCVDSlope(now, this.config.cvdSlopeWindowShort),
      slope5m: this.calculateCVDSlope(now, this.config.cvdSlopeWindowLong),
      points: this.cvdPoints.slice(-100), // Son 100 point
      divergenceDetected: false, // FAZ 2'de implement edilecek
    };
  }

  public getCurrentCVD(): number { return this.currentCVD; }

  public calculateCVDSlope(now: number, windowMs: number): number {
    if (this.cvdPoints.length < 2) return 0;
    const cutoff = now - windowMs;
    const windowPoints = this.cvdPoints.filter((p) => p.timestamp >= cutoff);
    if (windowPoints.length < 2) return 0;

    // ── Linear regression slope ──
    const n = windowPoints.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const point of windowPoints) {
      const x = (point.timestamp - cutoff) / 1000; // Normalize to seconds
      const y = point.cvd;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return 0; // ── Sıfır bölme koruması ──
    return (n * sumXY - sumX * sumY) / denom;
  }

  // ── WHALE DETECTION ──

  private detectWhale(trade: TradeEvent): void {
    if (!trade.isWhale) return;
    const now = trade.timestamp;
    if (now - this.lastWhaleTimestamp < this.config.whaleCooldownMs) return;
    this.lastWhaleTimestamp = now;

    const event = this.buildFlowEvent(
      FlowEventType.WHALE, trade.side, trade.price, trade.notional, now,
      `Whale ${trade.side.toUpperCase()}: $${this.formatNotional(trade.notional)} @ ${trade.price}`
    );
    this.emit("flowEvent", event);
    this.emit("whaleDetected", event);
  }

  // ── SWEEP DETECTION ──

  private detectSweep(trade: TradeEvent): void {
    const now = trade.timestamp;
    const windowStart = now - this.config.sweepWindowMs;
    const recentTrades = this.trades.getByTimeRange(windowStart, now);
    const sameDirection = recentTrades.filter((t) => t.side === trade.side);

    if (sameDirection.length < this.config.sweepMinPrints) return;

    const totalNotional = sameDirection.reduce((sum, t) => sum + t.notional, 0);
    const threshold = this.config.whaleThresholdNotional * this.config.sweepMultiplier;

    if (totalNotional >= threshold) {
      const event = this.buildFlowEvent(
        FlowEventType.SWEEP, trade.side, trade.price, totalNotional, now,
        `Sweep ${trade.side.toUpperCase()}: ${sameDirection.length} prints, $${this.formatNotional(totalNotional)} in ${(this.config.sweepWindowMs / 1000).toFixed(1)}s`
      );
      this.emit("flowEvent", event);
    }
  }

  // ── ABSORPTION DETECTION ──

  private detectAbsorption(timestamp: number): void {
    const windowStart = timestamp - this.config.absorptionWindowMs;
    const recentTrades = this.trades.getByTimeRange(windowStart, timestamp);
    if (recentTrades.length < 5) return;

    // ── Net delta hesapla ──
    let buyDelta = 0, sellDelta = 0;
    let minPrice = Infinity, maxPrice = 0;
    for (const t of recentTrades) {
      if (t.side === "buy") buyDelta += t.notional;
      else sellDelta += t.notional;
      if (t.price < minPrice) minPrice = t.price;
      if (t.price > maxPrice) maxPrice = t.price;
    }

    const netDelta = Math.abs(buyDelta - sellDelta);
    const threshold = this.config.whaleThresholdNotional * this.config.absorptionDeltaMultiplier;

    if (netDelta < threshold) return;

    // ── Fiyat hareketi kontrolü ──
    const midPrice = (maxPrice + minPrice) * 0.5;
    if (midPrice <= 0) return;
    const priceMovePct = ((maxPrice - minPrice) / midPrice) * 100;

    if (priceMovePct < this.config.absorptionMaxPriceMovePct) {
      const dominantSide: TradeSide = buyDelta > sellDelta ? "buy" : "sell";
      const event = this.buildFlowEvent(
        FlowEventType.ABSORPTION, dominantSide, midPrice, netDelta, timestamp,
        `Absorption ${dominantSide.toUpperCase()}: Δ$${this.formatNotional(netDelta)}, price move ${priceMovePct.toFixed(3)}%`
      );
      this.emit("flowEvent", event);
    }
  }

  // ── DELTA BURST DETECTION ──

  private detectDeltaBurst(timestamp: number): void {
    const slope = this.calculateCVDSlope(timestamp, this.config.cvdSlopeWindowShort);
    const threshold = this.config.whaleThresholdNotional * this.config.deltaBurstSlopeMultiplier;

    if (Math.abs(slope) >= threshold) {
      const side: TradeSide = slope > 0 ? "buy" : "sell";
      const event = this.buildFlowEvent(
        FlowEventType.DELTA_BURST, side, 0, Math.abs(slope), timestamp,
        `Delta Burst ${side.toUpperCase()}: slope=${slope.toFixed(0)} $/s`
      );
      this.emit("flowEvent", event);
    }
  }

  // ── UTILITIES ──

  private buildFlowEvent(
    type: FlowEventType, side: TradeSide | null,
    price: number, notional: number, timestamp: number, detail: string
  ): FlowEvent {
    return { type, side, symbol: this.symbol, price, notional, timestamp, detail };
  }

  private pruneCVDPoints(now: number): void {
    const cutoff = now - this.config.cvdWindowSizeMs;
    while (this.cvdPoints.length > 0 && this.cvdPoints[0].timestamp < cutoff) {
      this.cvdPoints.shift();
    }
  }

  private formatNotional(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toFixed(0);
  }

  /** Symbol değişiminde state temizle */
  public reset(): void {
    this.currentCVD = 0;
    this.lastWhaleTimestamp = 0;
    this.trades.clear();
    this.cvdPoints.length = 0;
    this.spoofTracker.clear();
  }

  /** Son N trade'i al (FAZ 1 PredatorSignalEngine için) */
  public getRecentTrades(count: number): TradeEvent[] {
    return this.trades.getLatest(count);
  }

  /** Son pencere içindeki flow event sayıları */
  public getFlowEventSummary(windowMs: number = 60000): Record<FlowEventType, number> {
    const summary: Record<string, number> = {};
    for (const type of Object.values(FlowEventType)) {
      summary[type] = 0;
    }
    // Bu basit bir summary; gerçek implementasyonda event'leri de ring buffer'da tutmak gerekir.
    // Şimdilik spoof count'u dönelim:
    summary[FlowEventType.SPOOF] = this.getSpoofCount(windowMs);
    return summary as Record<FlowEventType, number>;
  }

  // ── EVENT SYSTEM ──
  public on<K extends keyof OrderFlowEvents>(event: K, handler: EventHandler<OrderFlowEvents[K]>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  public off<K extends keyof OrderFlowEvents>(event: K, handler: EventHandler<OrderFlowEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof OrderFlowEvents>(event: K, data: OrderFlowEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) {
          console.error(`[OrderFlowEngine] Handler error on '${String(event)}':`, err);
        }
      }
    }
  }
}
