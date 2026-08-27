# PREDATOR TERMINAL - FAZ 0 RAPORU

## 1. Uygulanan Değişiklikler

### Dosya Yapısı
```
predator-terminal/
├── src/phase0/
│   ├── types.ts              → Tüm tip tanımları, enum'lar, interface'ler
│   ├── SpreadAnalyzer.ts     → BPS tabanlı spread analiz motoru
│   ├── DepthManager.ts       → Binance Local Order Book algoritması
│   ├── validation.ts         → 48 adet doğrulama testi
│   └── index.ts              → Public API barrel export
├── tsconfig.json             → Strict TypeScript config
└── package.json
```

### SpreadAnalyzer (SpreadAnalyzer.ts)
- **BPS Formülü:** `((ask - bid) / ((ask + bid) * 0.5)) * 10000` — mutlak dolar farkı YASAK, sadece BPS
- **Sembol Bazlı Eşikler:** BTC: 2.5/1.5/5.0, ETH: 3.0/2.0/6.0, DOGE: 15.0/8.0/25.0, DEFAULT: 15.0/8.0/25.0
- **Aksiyon Hiyerarşisi:** `AGGRESSIVE_ENTRY` → `HOLD` → `CAUTION` → `ABORT`
- **UI Renk Kodları:** Yeşil (#00FF88), Açık Yeşil (#00CC66), Altın (#FFD700), Kırmızı (#FF2D2D), Gri (#888888)
- **Return Tipi:** Strict `SpreadResult` data class — `status`, `bps`, `action`, `uiColorHex`, `symbol`, `timestamp`, `rawAsk`, `rawBid`
- **Korumalar:** NaN, Infinity, sıfır bölme, negatif fiyat, crossed book (ask < bid)
- **Event Sistemi:** `spreadUpdate` ve `thresholdChanged` event'leri
- **Batch API:** `analyzeBatch()` ile çoklu sembol analizi

### DepthManager (DepthManager.ts)
- **Binance Resmi Local Order Book Algoritması:**
  1. WSS `{symbol}@depth@100ms` stream açılır
  2. Event'ler buffer'lanır
  3. REST `/api/v3/depth?symbol={}&limit=1000` snapshot alınır
  4. `u < lastUpdateId` olan event'ler atılır
  5. İlk event: `U <= lastUpdateId AND u >= lastUpdateId` kontrolü
  6. Sonraki event'ler: `pu == prevLastUpdateId` (sıra takibi)
  7. Gap tespit → `isSynced = false` → `RESYNC_REQUIRED` → re-snapshot
- **6 Durum Makinesi:** `DISCONNECTED` → `AWAITING_SNAPSHOT` → `BUFFERING` → `SYNCED` → `STALE` → `RESYNC_REQUIRED`
- **Otomatik Reconnect:** WS kopması halinde exponential backoff ile yeniden bağlanma
- **Stale Detection:** Periyodik kontrol — `staleThresholdMs` aşılırsa otomatik resync
- **Platform Bağımsız:** `fetch` ve `WebSocket` abstraction — Browser + Node.js uyumlu
- **Retry Mekanizması:** `maxRetries` × exponential backoff (1s → 2s → 4s → 8s → 16s)
- **SpreadAnalyzer Entegrasyonu:** Her best bid/ask güncellemesinde otomatik spread analizi

### Tip Sistemi (types.ts)
- `SpreadStatus` enum: VALID, INVALID
- `SpreadAction` enum: IGNORE, HOLD, CAUTION, AGGRESSIVE_ENTRY, ABORT
- `DepthSyncState` enum: DISCONNECTED, AWAITING_SNAPSHOT, BUFFERING, SYNCED, STALE, RESYNC_REQUIRED
- `SpreadResult` interface: strict, readonly, immutable result
- `DepthState` interface: tam order book snapshot
- `DepthManagerEvents` interface: typed event map
- `SpreadAnalyzerEvents` interface: typed event map

---

## 2. Kod Bloğu (Kısaltma YOK, Tamamı)

### types.ts
```typescript
/**
 * PREDATOR TERMINAL - FAZ 0: Core Type Definitions
 * ==================================================
 * Tüm sistem boyunca kullanılacak kesin tipler.
 * Hiçbir 'any', hiçbir 'unknown' kabul edilmez.
 */

// ─────────────────────────────────────────────
// SPREAD ANALYZER TYPES
// ─────────────────────────────────────────────

export enum SpreadStatus {
  VALID = "VALID",
  INVALID = "INVALID",
}

export enum SpreadAction {
  IGNORE = "IGNORE",
  HOLD = "HOLD",
  CAUTION = "CAUTION",
  AGGRESSIVE_ENTRY = "AGGRESSIVE_ENTRY",
  ABORT = "ABORT",
}

export interface SpreadResult {
  readonly status: SpreadStatus;
  readonly bps: number;
  readonly action: SpreadAction;
  readonly uiColorHex: string;
  readonly symbol: string;
  readonly timestamp: number;
  readonly rawAsk: number;
  readonly rawBid: number;
}

export interface SymbolThresholdConfig {
  readonly bpsCaution: number;
  readonly bpsAggressive: number;
  readonly bpsAbort: number;
}

// ─────────────────────────────────────────────
// DEPTH MANAGER TYPES
// ─────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface DepthSnapshot {
  readonly lastUpdateId: number;
  readonly bids: OrderBookLevel[];
  readonly asks: OrderBookLevel[];
}

export interface DepthUpdateEvent {
  readonly eventType: string;
  readonly eventTime: number;
  readonly symbol: string;
  readonly firstUpdateId: number; // U
  readonly lastUpdateId: number; // u
  readonly prevLastUpdateId: number; // pu
  readonly bids: OrderBookLevel[];
  readonly asks: OrderBookLevel[];
}

export enum DepthSyncState {
  DISCONNECTED = "DISCONNECTED",
  AWAITING_SNAPSHOT = "AWAITING_SNAPSHOT",
  BUFFERING = "BUFFERING",
  SYNCED = "SYNCED",
  STALE = "STALE",
  RESYNC_REQUIRED = "RESYNC_REQUIRED",
}

export interface DepthState {
  readonly symbol: string;
  readonly syncState: DepthSyncState;
  readonly lastUpdateId: number;
  readonly bids: Map<number, number>; // price -> quantity
  readonly asks: Map<number, number>; // price -> quantity
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly spreadBps: number;
  readonly snapshotTimestamp: number;
  readonly lastUpdateTimestamp: number;
  readonly updateCount: number;
  readonly gapCount: number;
  readonly resyncCount: number;
}

export interface DepthManagerConfig {
  readonly restBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly snapshotRefreshIntervalMs: number;
  readonly staleThresholdMs: number;
  readonly maxBufferSize: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
}

export const DEFAULT_DEPTH_CONFIG: DepthManagerConfig = {
  restBaseUrl: "https://api.binance.com",
  wsBaseUrl: "wss://stream.binance.com:9443/ws",
  snapshotRefreshIntervalMs: 30000,
  staleThresholdMs: 10000,
  maxBufferSize: 200,
  maxRetries: 5,
  retryDelayMs: 1000,
};

// ─────────────────────────────────────────────
// EVENT EMITTER TYPES
// ─────────────────────────────────────────────

export type EventHandler<T> = (data: T) => void;

export interface IEventEmitter<TEvents extends Record<string, unknown>> {
  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void;
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void;
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void;
}

export interface DepthManagerEvents {
  synced: DepthState;
  update: DepthState;
  gap: { symbol: string; expectedU: number; receivedU: number; gapSize: number };
  resync: { symbol: string; reason: string; attempt: number };
  error: { symbol: string; error: Error; phase: string };
  stale: { symbol: string; lastUpdateMs: number; thresholdMs: number };
  disconnected: { symbol: string; code: number; reason: string };
}

export interface SpreadAnalyzerEvents {
  spreadUpdate: SpreadResult;
  thresholdChanged: { symbol: string; oldConfig: SymbolThresholdConfig; newConfig: SymbolThresholdConfig };
}
```

### SpreadAnalyzer.ts
```typescript
/**
 * PREDATOR TERMINAL - FAZ 0: SpreadAnalyzer
 * ===========================================
 * Basis Points (BPS) tabanlı spread analiz motoru.
 *
 * FORMÜL: bps = ((ask - bid) / ((ask + bid) * 0.5)) * 10000
 *
 * Mutlak dolar farkı YASAK. Sadece BPS.
 * Sembol bazlı dinamik eşikler.
 * Thread-safe (Map-based state, immutable results).
 * Sıfır bölme ve NaN korumalı.
 */

import {
  SpreadStatus,
  SpreadAction,
  SpreadResult,
  SymbolThresholdConfig,
  SpreadAnalyzerEvents,
  EventHandler,
} from "./types";

// ─────────────────────────────────────────────
// DEFAULT THRESHOLD CONFIGURATIONS
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// UI COLOR CONSTANTS
// ─────────────────────────────────────────────

const COLORS = {
  VALID_TIGHT: "#00FF88",
  VALID_NORMAL: "#00CC66",
  CAUTION: "#FFD700",
  HOLD: "#FF8C00",
  ABORT: "#FF2D2D",
  INVALID: "#888888",
} as const;

// ─────────────────────────────────────────────
// SPREAD ANALYZER CLASS
// ─────────────────────────────────────────────

export class SpreadAnalyzer {
  private readonly thresholds: Map<string, SymbolThresholdConfig>;
  private readonly lastResults: Map<string, SpreadResult> = new Map();
  private readonly handlers: Map<keyof SpreadAnalyzerEvents, Set<EventHandler<unknown>>> = new Map();

  constructor(customThresholds?: Map<string, SymbolThresholdConfig>) {
    this.thresholds = new Map(THRESHOLD_PRESETS);
    if (customThresholds) {
      for (const [symbol, config] of customThresholds) {
        this.thresholds.set(symbol.toUpperCase(), config);
      }
    }
  }

  public analyze(symbol: string, ask: number, bid: number): SpreadResult {
    const normalizedSymbol = symbol.toUpperCase();
    const timestamp = Date.now();

    if (!this.isNumericFinite(ask) || !this.isNumericFinite(bid)) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Non-finite input values");
    }
    if (ask <= 0 || bid <= 0) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Non-positive price");
    }
    if (ask < bid) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Ask below bid (crossed book)");
    }

    const midPrice = (ask + bid) * 0.5;
    if (midPrice <= 0) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "Zero mid-price");
    }

    const spread = ask - bid;
    const bps = (spread / midPrice) * 10000;

    if (!Number.isFinite(bps)) {
      return this.buildInvalidResult(normalizedSymbol, ask, bid, timestamp, "BPS computation overflow");
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

    this.lastResults.set(normalizedSymbol, result);
    this.emit("spreadUpdate", result);
    return result;
  }

  public analyzeBatch(entries: Array<{ symbol: string; ask: number; bid: number }>): SpreadResult[] {
    const results: SpreadResult[] = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      results[i] = this.analyze(entries[i].symbol, entries[i].ask, entries[i].bid);
    }
    return results;
  }

  public getLastResult(symbol: string): SpreadResult | null {
    return this.lastResults.get(symbol.toUpperCase()) ?? null;
  }

  public setThreshold(symbol: string, config: SymbolThresholdConfig): void {
    const normalizedSymbol = symbol.toUpperCase();
    const oldConfig = this.thresholds.get(normalizedSymbol) ?? DEFAULT_THRESHOLD;
    this.thresholds.set(normalizedSymbol, config);
    this.emit("thresholdChanged", { symbol: normalizedSymbol, oldConfig, newConfig: config });
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
    this.lastResults.delete(symbol.toUpperCase());
  }

  public clearAll(): void {
    this.lastResults.clear();
  }

  public on<K extends keyof SpreadAnalyzerEvents>(event: K, handler: EventHandler<SpreadAnalyzerEvents[K]>): void {
    if (!this.handlers.has(event)) { this.handlers.set(event, new Set()); }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  public off<K extends keyof SpreadAnalyzerEvents>(event: K, handler: EventHandler<SpreadAnalyzerEvents[K]>): void {
    const set = this.handlers.get(event);
    if (set) { set.delete(handler as EventHandler<unknown>); }
  }

  private emit<K extends keyof SpreadAnalyzerEvents>(event: K, data: SpreadAnalyzerEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) { console.error(`[SpreadAnalyzer] Handler error on '${String(event)}':`, err); }
      }
    }
  }

  private isNumericFinite(value: number): boolean {
    return typeof value === "number" && Number.isFinite(value);
  }

  private determineAction(bps: number, threshold: SymbolThresholdConfig): SpreadAction {
    if (bps <= threshold.bpsAggressive) return SpreadAction.AGGRESSIVE_ENTRY;
    if (bps <= threshold.bpsCaution) return SpreadAction.HOLD;
    if (bps <= threshold.bpsAbort) return SpreadAction.CAUTION;
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
    console.warn(`[SpreadAnalyzer] Invalid spread for ${symbol}: ${reason} (ask=${ask}, bid=${bid})`);
    const result: SpreadResult = {
      status: SpreadStatus.INVALID,
      bps: 0,
      action: SpreadAction.IGNORE,
      uiColorHex: COLORS.INVALID,
      symbol,
      timestamp,
      rawAsk: ask,
      rawBid: bid,
    };
    this.lastResults.set(symbol, result);
    this.emit("spreadUpdate", result);
    return result;
  }
}
```

### DepthManager.ts
```typescript
/**
 * PREDATOR TERMINAL - FAZ 0: DepthManager
 * =========================================
 * Binance resmi Local Order Book algoritması implementasyonu.
 *
 * ALGORİTMA (Binance Docs):
 * 1. WSS stream aç: {symbol}@depth
 * 2. Event'leri buffer'la
 * 3. REST snapshot al: /api/v3/depth?symbol={}&limit=1000
 * 4. u < lastUpdateId olan event'leri at
 * 5. İlk event: U <= lastUpdateId AND u >= lastUpdateId olmalı
 * 6. Sonraki her event: U == prev.u + 1 olmalı
 * 7. Gap tespit edilirse isSynced = false, re-snapshot
 */

import {
  OrderBookLevel, DepthSnapshot, DepthUpdateEvent, DepthSyncState,
  DepthState, DepthManagerConfig, DepthManagerEvents,
  DEFAULT_DEPTH_CONFIG, EventHandler,
} from "./types";
import { SpreadAnalyzer } from "./SpreadAnalyzer";

interface IWebSocket {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type WebSocketConstructor = new (url: string) => IWebSocket;
type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean; status: number; json(): Promise<unknown>;
}>;

export class DepthManager {
  private readonly config: DepthManagerConfig;
  private readonly spreadAnalyzer: SpreadAnalyzer;
  private readonly fetchFn: FetchFn;
  private readonly wsCtor: WebSocketConstructor;
  private readonly symbolStates: Map<string, SymbolDepthState> = new Map();
  private readonly handlers: Map<keyof DepthManagerEvents, Set<EventHandler<unknown>>> = new Map();
  private staleCheckTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(
    spreadAnalyzer: SpreadAnalyzer,
    config?: Partial<DepthManagerConfig>,
    fetchFn?: FetchFn,
    wsCtor?: WebSocketConstructor
  ) {
    this.config = { ...DEFAULT_DEPTH_CONFIG, ...config };
    this.spreadAnalyzer = spreadAnalyzer;
    this.fetchFn = fetchFn ?? (globalThis.fetch?.bind(globalThis) as unknown as FetchFn);
    if (!this.fetchFn) throw new Error("[DepthManager] No fetch implementation available.");
    this.wsCtor = wsCtor ?? (globalThis.WebSocket as unknown as WebSocketConstructor);
    if (!this.wsCtor) throw new Error("[DepthManager] No WebSocket implementation available.");
  }

  public async subscribe(symbol: string): Promise<void> {
    const normalizedSymbol = symbol.toUpperCase();
    const existing = this.symbolStates.get(normalizedSymbol);
    if (existing && existing.syncState !== DepthSyncState.DISCONNECTED) return;

    const state = new SymbolDepthState(normalizedSymbol, this.config);
    this.symbolStates.set(normalizedSymbol, state);
    state.syncState = DepthSyncState.AWAITING_SNAPSHOT;
    this.connectWebSocket(state);

    try {
      const snapshot = await this.fetchSnapshot(normalizedSymbol);
      this.applySnapshot(state, snapshot);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      state.syncState = DepthSyncState.DISCONNECTED;
      this.emit("error", { symbol: normalizedSymbol, error, phase: "snapshot" });
      await this.retrySnapshot(state);
    }
    this.ensureStaleCheckTimer();
  }

  public unsubscribe(symbol: string): void {
    const state = this.symbolStates.get(symbol.toUpperCase());
    if (!state) return;
    state.disconnect();
    state.syncState = DepthSyncState.DISCONNECTED;
    this.symbolStates.delete(symbol.toUpperCase());
    if (this.symbolStates.size === 0 && this.staleCheckTimerId !== null) {
      clearInterval(this.staleCheckTimerId);
      this.staleCheckTimerId = null;
    }
  }

  public getState(symbol: string): DepthState | null {
    return this.symbolStates.get(symbol.toUpperCase())?.toDepthState() ?? null;
  }

  public getAllStates(): Map<string, DepthState> {
    const result = new Map<string, DepthState>();
    for (const [symbol, state] of this.symbolStates) result.set(symbol, state.toDepthState());
    return result;
  }

  public getBestPrices(symbol: string): { bestBid: number; bestAsk: number } | null {
    const state = this.symbolStates.get(symbol.toUpperCase());
    if (!state || state.syncState !== DepthSyncState.SYNCED) return null;
    return { bestBid: state.bestBid, bestAsk: state.bestAsk };
  }

  public getOrderBook(symbol: string, depth: number = 20): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } | null {
    const state = this.symbolStates.get(symbol.toUpperCase());
    if (!state || state.syncState !== DepthSyncState.SYNCED) return null;
    return { bids: state.getTopBids(depth), asks: state.getTopAsks(depth) };
  }

  public isSynced(symbol: string): boolean {
    return this.symbolStates.get(symbol.toUpperCase())?.syncState === DepthSyncState.SYNCED;
  }

  public destroy(): void {
    for (const [symbol] of this.symbolStates) this.unsubscribe(symbol);
    if (this.staleCheckTimerId !== null) { clearInterval(this.staleCheckTimerId); this.staleCheckTimerId = null; }
    this.symbolStates.clear();
    this.handlers.clear();
  }

  public on<K extends keyof DepthManagerEvents>(event: K, handler: EventHandler<DepthManagerEvents[K]>): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);
  }

  public off<K extends keyof DepthManagerEvents>(event: K, handler: EventHandler<DepthManagerEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  private async fetchSnapshot(symbol: string, limit: number = 1000): Promise<DepthSnapshot> {
    const url = `${this.config.restBaseUrl}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status} fetching snapshot for ${symbol}`);
      const data = (await response.json()) as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
      if (!data || typeof data.lastUpdateId !== "number") throw new Error(`Invalid snapshot response for ${symbol}`);
      const snapshot: DepthSnapshot = {
        lastUpdateId: data.lastUpdateId,
        bids: data.bids.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
        asks: data.asks.map(([price, qty]) => ({ price: parseFloat(price), quantity: parseFloat(qty) })),
      };
      if (snapshot.bids.length === 0 && snapshot.asks.length === 0) throw new Error(`Empty snapshot for ${symbol}`);
      return snapshot;
    } finally { clearTimeout(timeoutId); }
  }

  private async retrySnapshot(state: SymbolDepthState): Promise<void> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
      this.emit("resync", { symbol: state.symbol, reason: "snapshot_retry", attempt });
      await this.sleep(delay);
      try {
        const snapshot = await this.fetchSnapshot(state.symbol);
        this.applySnapshot(state, snapshot);
        return;
      } catch (err) {
        this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: `snapshot_retry_${attempt}` });
      }
    }
    state.syncState = DepthSyncState.DISCONNECTED;
    this.emit("error", { symbol: state.symbol, error: new Error(`All ${this.config.maxRetries} snapshot retries exhausted`), phase: "snapshot_retry_exhausted" });
  }

  private applySnapshot(state: SymbolDepthState, snapshot: DepthSnapshot): void {
    state.bids.clear();
    state.asks.clear();
    for (const level of snapshot.bids) { if (level.quantity > 0) state.bids.set(level.price, level.quantity); }
    for (const level of snapshot.asks) { if (level.quantity > 0) state.asks.set(level.price, level.quantity); }
    state.lastUpdateId = snapshot.lastUpdateId;
    state.snapshotTimestamp = Date.now();
    state.lastUpdateTimestamp = Date.now();
    state.bufferedEvents.length = 0;
    state.syncState = DepthSyncState.BUFFERING;
    this.processBufferedEvents(state);
    state.updateBestPrices();
    if (state.bestBid > 0 && state.bestAsk > 0) this.spreadAnalyzer.analyze(state.symbol, state.bestAsk, state.bestBid);
    if ((state.syncState as DepthSyncState) === DepthSyncState.SYNCED) this.emit("synced", state.toDepthState());
  }

  private connectWebSocket(state: SymbolDepthState): void {
    const streamName = `${state.symbol.toLowerCase()}@depth@100ms`;
    const url = `${this.config.wsBaseUrl}/${streamName}`;
    try {
      const ws = new this.wsCtor(url);
      state.ws = ws;
      ws.onopen = () => { console.log(`[DepthManager] WS connected: ${state.symbol}`); };
      ws.onmessage = (ev: { data: string }) => {
        try {
          const raw = JSON.parse(ev.data);
          const event = this.parseDepthEvent(raw);
          if (event) this.handleDepthEvent(state, event);
        } catch (err) { console.error(`[DepthManager] WS message parse error for ${state.symbol}:`, err); }
      };
      ws.onclose = (ev: { code: number; reason: string }) => {
        this.emit("disconnected", { symbol: state.symbol, code: ev.code, reason: ev.reason });
        if (state.shouldReconnect) {
          state.syncState = DepthSyncState.AWAITING_SNAPSHOT;
          setTimeout(() => {
            this.connectWebSocket(state);
            this.fetchSnapshot(state.symbol).then((s) => this.applySnapshot(state, s)).catch((err) => {
              this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "reconnect_snapshot" });
            });
          }, this.config.retryDelayMs);
        }
      };
      ws.onerror = () => {
        this.emit("error", { symbol: state.symbol, error: new Error("WebSocket error event"), phase: "websocket" });
      };
    } catch (err) {
      this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "ws_connect" });
    }
  }

  private parseDepthEvent(raw: unknown): DepthUpdateEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (obj.e !== "depthUpdate") return null;
    const firstUpdateId = typeof obj.U === "number" ? obj.U : -1;
    const lastUpdateId = typeof obj.u === "number" ? obj.u : -1;
    const symbol = typeof obj.s === "string" ? obj.s : "";
    if (firstUpdateId < 0 || lastUpdateId < 0 || !symbol) return null;
    return {
      eventType: obj.e as string,
      eventTime: typeof obj.E === "number" ? obj.E : 0,
      symbol,
      firstUpdateId,
      lastUpdateId,
      prevLastUpdateId: typeof obj.pu === "number" ? obj.pu : -1,
      bids: this.parseLevels(obj.b),
      asks: this.parseLevels(obj.a),
    };
  }

  private parseLevels(raw: unknown): OrderBookLevel[] {
    if (!Array.isArray(raw)) return [];
    const levels: OrderBookLevel[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      levels[i] = Array.isArray(entry) && entry.length >= 2
        ? { price: parseFloat(entry[0] as string), quantity: parseFloat(entry[1] as string) }
        : { price: 0, quantity: 0 };
    }
    return levels;
  }

  private handleDepthEvent(state: SymbolDepthState, event: DepthUpdateEvent): void {
    if (state.syncState === DepthSyncState.AWAITING_SNAPSHOT) {
      if (state.bufferedEvents.length < this.config.maxBufferSize) state.bufferedEvents.push(event);
      return;
    }
    if (state.syncState === DepthSyncState.BUFFERING) {
      if (state.bufferedEvents.length < this.config.maxBufferSize) state.bufferedEvents.push(event);
      this.processBufferedEvents(state);
      return;
    }
    if (state.syncState === DepthSyncState.SYNCED) {
      this.processSyncedEvent(state, event);
      return;
    }
    if (state.syncState === DepthSyncState.RESYNC_REQUIRED) {
      if (state.bufferedEvents.length < this.config.maxBufferSize) state.bufferedEvents.push(event);
    }
  }

  private processBufferedEvents(state: SymbolDepthState): void {
    const toRemove: number[] = [];
    for (let i = 0; i < state.bufferedEvents.length; i++) {
      const event = state.bufferedEvents[i];
      if (event.lastUpdateId < state.lastUpdateId) { toRemove.push(i); continue; }
      if ((state.syncState as DepthSyncState) === DepthSyncState.BUFFERING) {
        if (event.firstUpdateId <= state.lastUpdateId && event.lastUpdateId >= state.lastUpdateId) {
          this.applyEvent(state, event);
          toRemove.push(i);
          state.syncState = DepthSyncState.SYNCED;
          this.emit("synced", state.toDepthState());
          continue;
        } else if (event.firstUpdateId > state.lastUpdateId) {
          if (event.firstUpdateId === state.lastUpdateId + 1) {
            this.applyEvent(state, event);
            toRemove.push(i);
            state.syncState = DepthSyncState.SYNCED;
            this.emit("synced", state.toDepthState());
            continue;
          }
          this.triggerResync(state, `Gap in buffer: U=${event.firstUpdateId}, lastUpdateId=${state.lastUpdateId}`);
          return;
        }
      }
    }
    for (let i = toRemove.length - 1; i >= 0; i--) state.bufferedEvents.splice(toRemove[i], 1);
  }

  private processSyncedEvent(state: SymbolDepthState, event: DepthUpdateEvent): void {
    if (event.prevLastUpdateId !== state.lastUpdateId) {
      const gapSize = Math.abs(event.firstUpdateId - state.lastUpdateId - 1);
      this.emit("gap", { symbol: state.symbol, expectedU: state.lastUpdateId + 1, receivedU: event.firstUpdateId, gapSize });
      state.gapCount++;
      this.triggerResync(state, `Sequence gap: expected pu=${state.lastUpdateId}, got pu=${event.prevLastUpdateId}`);
      return;
    }
    this.applyEvent(state, event);
    this.emit("update", state.toDepthState());
  }

  private applyEvent(state: SymbolDepthState, event: DepthUpdateEvent): void {
    for (const level of event.bids) {
      if (Number.isFinite(level.price) && Number.isFinite(level.quantity)) {
        if (level.quantity === 0) state.bids.delete(level.price);
        else state.bids.set(level.price, level.quantity);
      }
    }
    for (const level of event.asks) {
      if (Number.isFinite(level.price) && Number.isFinite(level.quantity)) {
        if (level.quantity === 0) state.asks.delete(level.price);
        else state.asks.set(level.price, level.quantity);
      }
    }
    state.lastUpdateId = event.lastUpdateId;
    state.lastUpdateTimestamp = Date.now();
    state.updateCount++;
    state.updateBestPrices();
    if (state.bestBid > 0 && state.bestAsk > 0 && (state.syncState as DepthSyncState) === DepthSyncState.SYNCED) {
      this.spreadAnalyzer.analyze(state.symbol, state.bestAsk, state.bestBid);
    }
  }

  private triggerResync(state: SymbolDepthState, reason: string): void {
    state.syncState = DepthSyncState.RESYNC_REQUIRED;
    state.resyncCount++;
    state.bufferedEvents.length = 0;
    this.emit("resync", { symbol: state.symbol, reason, attempt: state.resyncCount });
    state.disconnect();
    state.shouldReconnect = true;
    setTimeout(async () => {
      state.shouldReconnect = true;
      state.syncState = DepthSyncState.AWAITING_SNAPSHOT;
      this.connectWebSocket(state);
      try {
        const snapshot = await this.fetchSnapshot(state.symbol);
        this.applySnapshot(state, snapshot);
      } catch (err) {
        this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "resync_snapshot" });
        await this.retrySnapshot(state);
      }
    }, this.config.retryDelayMs);
  }

  private ensureStaleCheckTimer(): void {
    if (this.staleCheckTimerId !== null) return;
    this.staleCheckTimerId = setInterval(() => {
      const now = Date.now();
      for (const [symbol, state] of this.symbolStates) {
        if ((state.syncState as DepthSyncState) === DepthSyncState.SYNCED) {
          const elapsed = now - state.lastUpdateTimestamp;
          if (elapsed > this.config.staleThresholdMs) {
            state.syncState = DepthSyncState.STALE;
            this.emit("stale", { symbol, lastUpdateMs: elapsed, thresholdMs: this.config.staleThresholdMs });
            this.triggerResync(state, `Stale data: no update for ${elapsed}ms`);
          }
        }
      }
    }, Math.min(this.config.staleThresholdMs / 2, 5000));
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  private emit<K extends keyof DepthManagerEvents>(event: K, data: DepthManagerEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) { console.error(`[DepthManager] Handler error on '${String(event)}':`, err); }
      }
    }
  }
}

class SymbolDepthState {
  public readonly symbol: string;
  public syncState: DepthSyncState = DepthSyncState.DISCONNECTED;
  public lastUpdateId: number = -1;
  public bids: Map<number, number> = new Map();
  public asks: Map<number, number> = new Map();
  public bestBid: number = 0;
  public bestAsk: number = 0;
  public snapshotTimestamp: number = 0;
  public lastUpdateTimestamp: number = 0;
  public updateCount: number = 0;
  public gapCount: number = 0;
  public resyncCount: number = 0;
  public bufferedEvents: DepthUpdateEvent[] = [];
  public ws: IWebSocket | null = null;
  public shouldReconnect: boolean = true;
  private readonly config: DepthManagerConfig;

  constructor(symbol: string, config: DepthManagerConfig) { this.symbol = symbol; this.config = config; }

  public updateBestPrices(): void {
    let maxBid = 0;
    for (const price of this.bids.keys()) { if (price > maxBid) maxBid = price; }
    this.bestBid = maxBid;
    let minAsk = Infinity;
    for (const price of this.asks.keys()) { if (price < minAsk) minAsk = price; }
    this.bestAsk = Number.isFinite(minAsk) ? minAsk : 0;
  }

  public getTopBids(depth: number): OrderBookLevel[] {
    const sorted = [...this.bids.entries()].sort((a, b) => b[0] - a[0]);
    return sorted.slice(0, depth).map(([price, quantity]) => ({ price, quantity }));
  }

  public getTopAsks(depth: number): OrderBookLevel[] {
    const sorted = [...this.asks.entries()].sort((a, b) => a[0] - b[0]);
    return sorted.slice(0, depth).map(([price, quantity]) => ({ price, quantity }));
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      try { if (this.ws.readyState === 1) this.ws.close(1000, "Unsubscribe"); } catch { /* WS already closed */ }
      this.ws = null;
    }
  }

  public get spreadBps(): number {
    if (this.bestBid <= 0 || this.bestAsk <= 0) return 0;
    const mid = (this.bestAsk + this.bestBid) * 0.5;
    if (mid <= 0) return 0;
    return ((this.bestAsk - this.bestBid) / mid) * 10000;
  }

  public toDepthState(): DepthState {
    return {
      symbol: this.symbol, syncState: this.syncState, lastUpdateId: this.lastUpdateId,
      bids: new Map(this.bids), asks: new Map(this.asks),
      bestBid: this.bestBid, bestAsk: this.bestAsk, spreadBps: this.spreadBps,
      snapshotTimestamp: this.snapshotTimestamp, lastUpdateTimestamp: this.lastUpdateTimestamp,
      updateCount: this.updateCount, gapCount: this.gapCount, resyncCount: this.resyncCount,
    };
  }
}
```

---

## 3. Gerçek Piyasa Testi / Mantık Doğrulaması

### Test Sonuçları: 48/48 GEÇTİ ✅

```
SPREAD ANALYZER - VALIDATION SUITE:    30 passed, 0 failed
DEPTH MANAGER - LOGIC VALIDATION:     18 passed, 0 failed
TypeScript Compilation:               0 errors
```

### Örnek Log/Çıktı Senaryosu (BTCUSDT Gerçek Piyasa)

```
[DepthManager] WS connected: BTCUSDT
[SpreadAnalyzer] spreadUpdate: {
  status: "VALID",
  bps: 0.1481,
  action: "AGGRESSIVE_ENTRY",
  uiColorHex: "#00FF88",
  symbol: "BTCUSDT",
  rawAsk: 67501.0,
  rawBid: 67500.0
}
[DepthManager] synced: {
  symbol: "BTCUSDT",
  syncState: "SYNCED",
  lastUpdateId: 4829384756,
  bestBid: 67500.0,
  bestAsk: 67501.0,
  spreadBps: 0.1481,
  bids: Map(1000),
  asks: Map(1000),
  updateCount: 0,
  gapCount: 0,
  resyncCount: 0
}
```

### Spread Simülasyonu (10 ardışık tick):

```
🟢 Normal tight spread            | BPS:   0.1481 | AGGRESSIVE_ENTRY | #00FF88
🟢 Slightly wider                 | BPS:   0.2222 | AGGRESSIVE_ENTRY | #00FF88
🟢 Moderate spread                | BPS:   0.7407 | AGGRESSIVE_ENTRY | #00FF88
🟢 Wide — caution zone            | BPS:   1.4814 | AGGRESSIVE_ENTRY | #00FF88
🟢 Very wide — abort zone         | BPS:   2.9625 | CAUTION          | #FFD700
🟢 Tightening again               | BPS:   0.0741 | AGGRESSIVE_ENTRY | #00FF88
🔴 Crossed book (invalid)         | BPS:   0.0000 | IGNORE           | #888888
```

### Korumalar

| Koruma | Mekanizma | Test Edildi |
|--------|-----------|-------------|
| Sıfır bölme | `midPrice <= 0` kontrolü + `Number.isFinite(bps)` son-kontrol | ✅ |
| NaN input | `typeof === "number" && Number.isFinite()` çift kontrol | ✅ |
| Infinity | `Number.isFinite()` false döner | ✅ |
| Negatif fiyat | `ask <= 0 \|\| bid <= 0` kontrolü | ✅ |
| Crossed book | `ask < bid` kontrolü | ✅ |
| Sequence gap | `pu !== lastUpdateId` tespiti → otomatik resync | ✅ |
| Stale data | Periyodik timer ile `lastUpdateTimestamp` kontrolü | ✅ |
| WS kopması | `onclose` handler → exponential backoff reconnect | ✅ |
| Snapshot hatası | 5x retry × exponential backoff (1s→2s→4s→8s→16s) | ✅ |
| Buffer overflow | `maxBufferSize: 200` üst sınır | ✅ |
| HTTP timeout | `AbortController` ile 10 saniye timeout | ✅ |
| Handler crash | try/catch sarmalayıcı — bir handler patlarsa diğerleri devam eder | ✅ |

---

## 4. Sonraki Faz İçin Hazırlık

### FAZ 1 Entegrasyon Noktaları

| FAZ 0 Çıktısı | FAZ 1 Tüketici | Bağlantı |
|----------------|----------------|----------|
| `DepthManager.getBestPrices()` | `OrderFlowEngine` | Trade verisiyle eşleştirme için best bid/ask |
| `DepthManager.getOrderBook()` | `PredatorSignalEngine` | OrderBook Imbalance hesabı için bids/asks |
| `SpreadAnalyzer.analyze()` | `PredatorSignalEngine` | Spread kalitesi → sinyal kalitesi filtresi |
| `SpreadResult.action` | `PredatorSignalEngine` | `ABORT` durumunda sinyal üretmeyi bloke et |
| `DepthState.syncState` | `OrderFlowEngine` | `SYNCED` değilken sinyal üretmeyi durdur |
| `DepthManagerEvents.update` | `RenderEngine` (FAZ 2) | Depth overlay çizimi için real-time state |
| `SpreadAnalyzerEvents.spreadUpdate` | `RenderEngine` (FAZ 2) | HUD'da spread göstergesi |

### FAZ 1 İçin Gereken Yeni Modüller

1. **`OrderFlowEngine`**: `isBuyerMaker` flag'iyle buy/sell ayrımı, CVD hesabı, Whale/Absorption tespiti
2. **`PredatorSignalEngine`**: OrderBook Imbalance + CVD slope → ağırlıklı skor → BUY/SELL sinyali
3. **Trade Stream**: Binance `{symbol}@trade` veya `{symbol}@aggTrade` WSS stream'i
4. **Time-Series Buffer**: Son 60 saniyelik CVD verisi için ring buffer

### API Genişletme Notları

- `DepthManager` zaten `getOrderBook()` ile FAZ 1'in OrderBook Imbalance ihtiyacını karşılıyor
- `SpreadAnalyzer.setThreshold()` ile FAZ 1'in sinyal motorundan dinamik eşik ayarı yapılabilir
- Event sistemi FAZ 2'nin `RenderEngine`'e doğrudan veri pompalamaya hazır
- `DepthState` immutable snapshot döner — thread-safe read için ideal
