/**
 * PREDATOR TERMINAL - FAZ 1: PredatorSignalEngine
 * ====================================================
 * Modüler skorlama motoru:
 * - liquidityModule: OrderBook Imbalance (±%25 → ±2 puan)
 * - flowModule: CVD eğimi + yüksek şiddetli flow olayları
 * - spreadModule: Spread kalitesi bonusu
 *
 * Toplam ≥ +2.5 → BUY, ≤ -2.5 → SELL
 * Her sinyale interval, intervalSec, barTime gömülü (FAZ 0 O.2 fix)
 * Her sinyale invalidation cümlesi
 * Regex YASAK — sadece yapısal veri (FAZ 0 O.5 fix)
 */

import {
  SignalDirection, SignalConfidence, SignalResult, SignalModuleScores,
  SignalEngineConfig, SignalEngineEvents,
  FlowEvent, FlowEventType, TradeSide,
  SpreadResult, SpreadStatus,
  EventHandler,
  DEFAULT_SIGNAL_ENGINE_CONFIG,
} from "../shared/types";
import { OrderFlowEngine } from "./OrderFlowEngine";
import { SpreadAnalyzer } from "../phase0/SpreadAnalyzer";

// ─────────────────────────────────────────────
// SIGNAL ENGINE
// ─────────────────────────────────────────────

export class PredatorSignalEngine {
  private readonly config: SignalEngineConfig;
  private readonly orderFlow: OrderFlowEngine;
  private readonly spreadAnalyzer: SpreadAnalyzer;
  private readonly handlers: Map<keyof SignalEngineEvents, Set<EventHandler<unknown>>> = new Map();

  private readonly signalBuffer: SignalResult[] = [];
  private lastSignalTimestamp: number = 0;
  private signalCounter: number = 0;

  /** Son flow event (flowModule için — yapısal, regex YOK) */
  private lastHighIntensityEvent: FlowEvent | null = null;

  constructor(
    orderFlow: OrderFlowEngine,
    spreadAnalyzer: SpreadAnalyzer,
    config?: Partial<SignalEngineConfig>
  ) {
    this.config = { ...DEFAULT_SIGNAL_ENGINE_CONFIG, ...config };
    this.orderFlow = orderFlow;
    this.spreadAnalyzer = spreadAnalyzer;

    // ── Flow event listener — yapısal veri (DÜZELTME O.5) ──
    this.orderFlow.on("flowEvent", (event: FlowEvent) => {
      if (this.isHighIntensity(event)) {
        this.lastHighIntensityEvent = event;
      }
    });
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Ana değerlendirme fonksiyonu. Her kapanmış mumda çağrılır.
   *
   * @param symbol - Sembol (örn: "BTCUSDT")
   * @param bids - Order book bids (price → quantity map)
   * @param asks - Order book asks (price → quantity map)
   * @param bestBid - En yüksek bid fiyatı
   * @param bestAsk - En düşük ask fiyatı
   * @param interval - Timeframe string (örn: "1m", "5m", "15m", "1h")
   * @param intervalSec - Timeframe saniye cinsinden (60, 300, 900, 3600)
   * @param barTime - Mevcut mumun açılış zamanı (unix ms)
   */
  public evaluate(
    symbol: string,
    bids: ReadonlyMap<number, number>,
    asks: ReadonlyMap<number, number>,
    bestBid: number,
    bestAsk: number,
    interval: string,
    intervalSec: number,
    barTime: number
  ): SignalResult | null {
    const now = Date.now();

    // ── Cooldown kontrolü ──
    if (now - this.lastSignalTimestamp < this.config.signalCooldownMs) {
      return null;
    }

    // ── Spread kalitesi kontrolü ──
    const spreadResult = this.spreadAnalyzer.getLastResult(symbol);
    if (!spreadResult || spreadResult.status === SpreadStatus.INVALID) {
      return null; // Veri çürük, sinyal üretme
    }

    // ── MODÜL SKORLARI ──
    const liquidityScore = this.liquidityModule(bids, asks, bestBid, bestAsk);
    const flowScore = this.flowModule();
    const spreadScore = this.spreadModule(spreadResult);

    // ── AĞIRIKLANDIRILMIŞ TOPLAM ──
    const totalScore =
      liquidityScore * this.config.wLiquidity +
      flowScore * this.config.wFlow +
      spreadScore * this.config.wSpread;

    // ── SİNYAL KARAR ──
    let direction: SignalDirection | null = null;
    if (totalScore >= this.config.buyThreshold) {
      direction = SignalDirection.BUY;
    } else if (totalScore <= this.config.sellThreshold) {
      direction = SignalDirection.SELL;
    }

    if (!direction) return null; // Eşik aşılmadı

    // ── GÜVEN SEVİYESİ ──
    const absScore = Math.abs(totalScore);
    let confidence: SignalConfidence;
    if (absScore >= 4.0) confidence = SignalConfidence.HIGH;
    else if (absScore >= 3.0) confidence = SignalConfidence.MEDIUM;
    else confidence = SignalConfidence.LOW;

    // ── INVALIDATION HESAPLAMA ──
    const { invalidationPrice, invalidationReason } = this.calculateInvalidation(
      direction, bestBid, bestAsk, intervalSec
    );

    // ── SİNYAL OBJESİ OLUŞTUR ──
    this.signalCounter++;
    const signal: SignalResult = {
      id: `SIG-${symbol}-${this.signalCounter}-${now}`,
      symbol: symbol.toUpperCase(),
      direction,
      score: Math.round(totalScore * 10000) / 10000,
      confidence,
      timestamp: now,
      barTime,
      interval,
      intervalSec,
      invalidationPrice,
      invalidationReason,
      modules: {
        liquidity: Math.round(liquidityScore * 10000) / 10000,
        flow: Math.round(flowScore * 10000) / 10000,
        spread: Math.round(spreadScore * 10000) / 10000,
        total: Math.round(totalScore * 10000) / 10000,
      },
      bestBid,
      bestAsk,
      spreadBps: spreadResult.bps,
    };

    // ── BUFFER & EMIT ──
    this.signalBuffer.push(signal);
    if (this.signalBuffer.length > this.config.maxSignalsBuffer) {
      this.signalBuffer.shift();
    }
    this.lastSignalTimestamp = now;
    this.lastHighIntensityEvent = null; // Reset after signal

    this.emit("signal", signal);
    return signal;
  }

  /** Son N sinyali döner */
  public getRecentSignals(count: number = 50): readonly SignalResult[] {
    return this.signalBuffer.slice(-count);
  }

  /** Tüm sinyal buffer'ını döner */
  public getAllSignals(): readonly SignalResult[] {
    return this.signalBuffer;
  }

  /** Config güncelle (runtime ayar değişikliği) */
  public updateConfig(partial: Partial<SignalEngineConfig>): void {
    Object.assign(this.config, partial);
  }

  public getConfig(): Readonly<SignalEngineConfig> {
    return this.config;
  }

  /** Symbol değişiminde reset */
  public reset(): void {
    this.lastSignalTimestamp = 0;
    this.lastHighIntensityEvent = null;
    this.signalBuffer.length = 0;
  }

  // ─────────────────────────────────────────────
  // MODULE: LIQUIDITY (OrderBook Imbalance)
  // ─────────────────────────────────────────────

  /**
   * OrderBook Imbalance hesabı.
   * Best bid/ask etrafındaki ±%1 bandındaki notional'ı karşılaştırır.
   *
   * Formül: imbalance = (bidNotional - askNotional) / (bidNotional + askNotional)
   * ±%25 imbalance → ±2 puan (lineer skalama)
   */
  private liquidityModule(
    bids: ReadonlyMap<number, number>,
    asks: ReadonlyMap<number, number>,
    bestBid: number,
    bestAsk: number
  ): number {
    if (bestBid <= 0 || bestAsk <= 0) return 0;

    const mid = (bestBid + bestAsk) * 0.5;
    if (mid <= 0) return 0;

    const bandPct = this.config.imbalanceThresholdPct / 100; // 0.25 → %25
    const lowerBound = mid * (1 - bandPct);
    const upperBound = mid * (1 + bandPct);

    let bidNotional = 0;
    for (const [price, qty] of bids) {
      if (price >= lowerBound && price <= mid) {
        bidNotional += price * qty;
      }
    }

    let askNotional = 0;
    for (const [price, qty] of asks) {
      if (price >= mid && price <= upperBound) {
        askNotional += price * qty;
      }
    }

    const totalNotional = bidNotional + askNotional;
    if (totalNotional <= 0) return 0;

    // ── Imbalance: +1 = tamamen bid, -1 = tamamen ask ──
    const imbalance = (bidNotional - askNotional) / totalNotional;

    // ── Lineer skalama: ±%25 imbalance → ±2 puan ──
    // imbalance ∈ [-1, +1], maxSkor = maxImbalanceScore (2.0)
    const score = imbalance * this.config.maxImbalanceScore;

    // ── Clamp ──
    return Math.max(-this.config.maxImbalanceScore, Math.min(this.config.maxImbalanceScore, score));
  }

  // ─────────────────────────────────────────────
  // MODULE: FLOW (CVD Slope + High Intensity Event)
  // ─────────────────────────────────────────────

  /**
   * DÜZELTME O.5: Regex YASAK.
   * Yön bilgisi event.side'dan okunur, text parse YOK.
   */
  private flowModule(): number {
    let score = 0;

    // ── CVD Slope Component ──
    const cvdSnapshot = this.orderFlow.getCVDSnapshot();
    const slopeNorm = this.normalizeCVDSlope(cvdSnapshot.slope1m);
    score += slopeNorm * this.config.cvdSlopeScore;

    // ── High Intensity Flow Event Component ──
    if (this.lastHighIntensityEvent) {
      const eventScore = this.scoreFlowEvent(this.lastHighIntensityEvent);
      score += eventScore * this.config.highIntensityFlowScore;
    }

    // ── Clamp to [-3, +3] ──
    return Math.max(-3, Math.min(3, score));
  }

  /**
   * CVD slope normalizasyonu.
   * Slope değerini [-1, +1] aralığına map eder.
   * Whale threshold'unun 2.5 katı = tam saturasyon.
   */
  private normalizeCVDSlope(slope: number): number {
    if (!Number.isFinite(slope)) return 0;
    const maxSlope = this.orderFlow["config"].whaleThresholdNotional * 2.5;
    if (maxSlope <= 0) return 0;
    return Math.max(-1, Math.min(1, slope / maxSlope));
  }

  /**
   * Flow event skorlaması — yapısal veri (side field).
   * Regex YOK, text parse YOK.
   */
  private scoreFlowEvent(event: FlowEvent): number {
    if (!event.side) return 0;
    const direction = event.side === "buy" ? 1 : -1;

    switch (event.type) {
      case FlowEventType.WHALE:
        return direction * 0.8;
      case FlowEventType.SWEEP:
        return direction * 1.0;
      case FlowEventType.ABSORPTION:
        return direction * 0.6;
      case FlowEventType.DELTA_BURST:
        return direction * 0.9;
      case FlowEventType.SPOOF:
        return 0; // Spoof yönsüz — güven düşürücü (FAZ 2'de)
      case FlowEventType.CVD_DIVERGENCE:
        return -direction * 0.5; // Divergence ters sinyal
      default:
        return 0;
    }
  }

  private isHighIntensity(event: FlowEvent): boolean {
    return event.type === FlowEventType.WHALE ||
           event.type === FlowEventType.SWEEP ||
           event.type === FlowEventType.ABSORPTION ||
           event.type === FlowEventType.DELTA_BURST;
  }

  // ─────────────────────────────────────────────
  // MODULE: SPREAD QUALITY
  // ─────────────────────────────────────────────

  /**
   * Spread kalitesi bonusu.
   * Tight spread = giriş için uygun = +bonus
   * Wide spread = giriş riskli = 0 veya -penalty
   */
  private spreadModule(spread: SpreadResult): number {
    if (spread.status === SpreadStatus.INVALID) return -1;
    if (spread.bps <= this.config.spreadQualityBpsThreshold) {
      return this.config.spreadQualityBonus;
    }
    // Wide spread: linear penalty
    const overThreshold = spread.bps - this.config.spreadQualityBpsThreshold;
    return Math.max(-0.5, this.config.spreadQualityBonus - overThreshold * 0.1);
  }

  // ─────────────────────────────────────────────
  // INVALIDATION
  // ─────────────────────────────────────────────

  private calculateInvalidation(
    direction: SignalDirection,
    bestBid: number,
    bestAsk: number,
    intervalSec: number
  ): { invalidationPrice: number; invalidationReason: string } {
    const mid = (bestBid + bestAsk) * 0.5;

    if (direction === SignalDirection.BUY) {
      // BUY sinyali: Kapanış bestBid altı = iptal
      const invalidPrice = bestBid;
      const pctFromMid = ((mid - invalidPrice) / mid * 100).toFixed(3);
      return {
        invalidationPrice: invalidPrice,
        invalidationReason: `Kapanış ${invalidPrice} altı zayıflatır (${pctFromMid}% aşağı)`,
      };
    } else {
      // SELL sinyali: Kapanış bestAsk üstü = iptal
      const invalidPrice = bestAsk;
      const pctFromMid = ((invalidPrice - mid) / mid * 100).toFixed(3);
      return {
        invalidationPrice: invalidPrice,
        invalidationReason: `Kapanış ${invalidPrice} üstü zayıflatır (${pctFromMid}% yukarı)`,
      };
    }
  }

  // ── EVENT SYSTEM ──
  public on<K extends keyof SignalEngineEvents>(event: K, handler: EventHandler<SignalEngineEvents[K]>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  public off<K extends keyof SignalEngineEvents>(event: K, handler: EventHandler<SignalEngineEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof SignalEngineEvents>(event: K, data: SignalEngineEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) {
          console.error(`[PredatorSignalEngine] Handler error on '${String(event)}':`, err);
        }
      }
    }
  }
}
