/**
 * PREDATOR TERMINAL - FAZ 0 v2: SpreadAnalyzer
 * ================================================
 * DÜZELTME #4: Throttle mekanizması eklendi.
 * Aynı sembol için son `throttleMs` içinde event fırlatıldıysa
 * yeni event suppress edilir. UI bombardımanı önlenir.
 */

import {
  SpreadStatus,
  SpreadAction,
  SpreadResult,
  SymbolThresholdConfig,
  SpreadAnalyzerEvents,
  EventHandler,
} from "../shared/types";

const THRESHOLD_PRESETS: ReadonlyMap<string, SymbolThresholdConfig> = new Map([
  ["BTCUSDT",  { bpsCaution: 2.5,  bpsAggressive: 1.5,  bpsAbort: 5.0 }],
  ["ETHUSDT",  { bpsCaution: 3.0,  bpsAggressive: 2.0,  bpsAbort: 6.0 }],
  ["BNBUSDT",  { bpsCaution: 4.0,  bpsAggressive: 2.5,  bpsAbort: 8.0 }],
  ["SOLUSDT",  { bpsCaution: 5.0,  bpsAggressive: 3.0,  bpsAbort: 10.0 }],
  ["DOGEUSDT", { bpsCaution: 15.0, bpsAggressive: 8.0,  bpsAbort: 25.0 }],
  ["SHIBUSDT", { bpsCaution: 15.0, bpsAggressive: 10.0, bpsAbort: 30.0 }],
  ["PEPEUSDT", { bpsCaution: 15.0, bpsAggressive: 8.0,  bpsAbort: 25.0 }],
]);

const DEFAULT_THRESHOLD: SymbolThresholdConfig = {
  bpsCaution: 15.0,
  bpsAggressive: 8.0,
  bpsAbort: 25.0,
};

const COLORS = {
  VALID_TIGHT: "#00FF88",
  VALID_NORMAL: "#00CC66",
  CAUTION: "#FFD700",
  HOLD: "#FF8C00",
  ABORT: "#FF2D2D",
  INVALID: "#888888",
} as const;

export class SpreadAnalyzer {
  private readonly thresholds: Map<string, SymbolThresholdConfig>;
  private readonly lastResults: Map<string, SpreadResult> = new Map();
  private readonly handlers: Map<keyof SpreadAnalyzerEvents, Set<EventHandler<unknown>>> = new Map();

  /**
   * DÜZELTME #4: Throttle mekanizması.
   * Her sembolün son emit timestamp'ini tutar.
   * throttleMs içinde tekrar emit yapılmaz.
   */
  private readonly lastEmitTimestamps: Map<string, number> = new Map();
  private readonly throttleMs: number;

  constructor(customThresholds?: Map<string, SymbolThresholdConfig>, throttleMs: number = 200) {
    this.thresholds = new Map(THRESHOLD_PRESETS);
    this.throttleMs = throttleMs;
    if (customThresholds) {
      for (const [symbol, config] of customThresholds) {
        this.thresholds.set(symbol.toUpperCase(), config);
      }
    }
  }

  public analyze(symbol: string, ask: number, bid: number): SpreadResult {
    const normalizedSymbol = symbol.toUpperCase();
    const timestamp = Date.now();

    // ── VALIDASYON ──
    if (!this.isNumericFinite(ask) || !this.isNumericFinite(bid)) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Non-finite input");
    }
    if (ask <= 0 || bid <= 0) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Non-positive price");
    }
    if (ask < bid) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Crossed book");
    }

    const midPrice = (ask + bid) * 0.5;
    if (midPrice <= 0) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Zero mid");
    }

    const spread = ask - bid;
    const bps = (spread / midPrice) * 10000;

    if (!Number.isFinite(bps)) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "BPS overflow");
    }

    const threshold = this.getThreshold(normalizedSymbol);
    const action = this.determineAction(bps, threshold);
    const uiColorHex = this.determineColor(action);

    const result: SpreadResult = {
      status: SpreadStatus.VALID,
      bps: Math.round(bps * 10000) / 10000,
      action,
      uiColorHex,
      symbol: normalizedSymbol,
      timestamp,
      rawAsk: ask,
      rawBid: bid,
    };

    // ── Her zaman cache'e yaz (throttle sadece emit'i etkiler) ──
    this.lastResults.set(normalizedSymbol, result);

    // ── DÜZELTME #4: THROTTLE KONTROLÜ ──
    const lastEmit = this.lastEmitTimestamps.get(normalizedSymbol) ?? 0;
    if (timestamp - lastEmit >= this.throttleMs) {
      this.lastEmitTimestamps.set(normalizedSymbol, timestamp);
      this.emit("spreadUpdate", result);
    }
    // Throttle altındaysa event fırlatılmaz ama result yine de döner.
    // UI katmanı getLastResult() ile her zaman güncel veriyi okuyabilir.

    return result;
  }

  public analyzeBatch(entries: Array<{ symbol: string; ask: number; bid: number }>): SpreadResult[] {
    const results: SpreadResult[] = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      results[i] = this.analyze(e.symbol, e.ask, e.bid);
    }
    return results;
  }

  public getLastResult(symbol: string): SpreadResult | null {
    return this.lastResults.get(symbol.toUpperCase()) ?? null;
  }

  public setThreshold(symbol: string, config: SymbolThresholdConfig): void {
    const ns = symbol.toUpperCase();
    const oldConfig = this.thresholds.get(ns) ?? DEFAULT_THRESHOLD;
    this.thresholds.set(ns, config);
    this.emit("thresholdChanged", { symbol: ns, oldConfig, newConfig: config });
  }

  public getThreshold(symbol: string): SymbolThresholdConfig {
    return this.thresholds.get(symbol.toUpperCase()) ?? DEFAULT_THRESHOLD;
  }

  public getAllThresholds(): ReadonlyMap<string, SymbolThresholdConfig> {
    return this.thresholds;
  }

  public getAllLastResults(): ReadonlyMap<string, SpreadResult> {
    return this.lastResults;
  }

  public clearSymbol(symbol: string): void {
    const ns = symbol.toUpperCase();
    this.lastResults.delete(ns);
    this.lastEmitTimestamps.delete(ns);
  }

  public clearAll(): void {
    this.lastResults.clear();
    this.lastEmitTimestamps.clear();
  }

  /** Throttle süresini runtime'da değiştir (ayarlar panelinden) */
  public setThrottleMs(ms: number): void {
    (this as unknown as { throttleMs: number }).throttleMs = Math.max(0, ms);
  }

  public getThrottleMs(): number {
    return this.throttleMs;
  }

  // ── EVENT SYSTEM ──
  public on<K extends keyof SpreadAnalyzerEvents>(event: K, handler: EventHandler<SpreadAnalyzerEvents[K]>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  public off<K extends keyof SpreadAnalyzerEvents>(event: K, handler: EventHandler<SpreadAnalyzerEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private emit<K extends keyof SpreadAnalyzerEvents>(event: K, data: SpreadAnalyzerEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) {
          console.error(`[SpreadAnalyzer] Handler error on '${String(event)}':`, err);
        }
      }
    }
  }

  private isNumericFinite(value: number): boolean {
    return typeof value === "number" && Number.isFinite(value);
  }

  private determineAction(bps: number, t: SymbolThresholdConfig): SpreadAction {
    if (bps <= t.bpsAggressive) return SpreadAction.AGGRESSIVE_ENTRY;
    if (bps <= t.bpsCaution) return SpreadAction.HOLD;
    if (bps <= t.bpsAbort) return SpreadAction.CAUTION;
    return SpreadAction.ABORT;
  }

  private determineColor(action: SpreadAction): string {
    switch (action) {
      case SpreadAction.AGGRESSIVE_ENTRY: return COLORS.VALID_TIGHT;
      case SpreadAction.HOLD: return COLORS.VALID_NORMAL;
      case SpreadAction.CAUTION: return COLORS.CAUTION;
      case SpreadAction.ABORT: return COLORS.ABORT;
      case SpreadAction.IGNORE: return COLORS.INVALID;
    }
  }

  private buildInvalidResult(symbol: string, ask: number, bid: number, timestamp: number, reason: string): SpreadResult {
    const result: SpreadResult = {
      status: SpreadStatus.INVALID, bps: 0, action: SpreadAction.IGNORE,
      uiColorHex: COLORS.INVALID, symbol, timestamp, rawAsk: ask, rawBid: bid,
    };
    this.lastResults.set(symbol, result);
    // Invalid sonuçlar her zaman emit edilir (throttle bypass)
    this.lastEmitTimestamps.set(symbol, timestamp);
    this.emit("spreadUpdate", result);
    return result;
  }
}
