/**
 * PREDATOR TERMINAL - FAZ 0 v2: DepthManager
 * =============================================
 * 4 Kritik Düzeltme:
 * #2 Graceful resync — WS açık kalır, snapshot yenilenir
 * #3 Dinamik stale threshold — sembol bazlı
 * #5 GC pressure — cached DepthState objesi, her update'te yeni obje YOK
 * #6 Buffer overflow — dinamik büyütme + overflow koruması
 */

import {
  OrderBookLevel, DepthSnapshot, DepthUpdateEvent, DepthSyncState,
  DepthState, DepthManagerConfig, DepthManagerEvents, StaleThresholdConfig,
  DEFAULT_DEPTH_CONFIG, EventHandler,
} from "../shared/types";
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
    if (!this.fetchFn) throw new Error("[DepthManager] No fetch implementation.");
    this.wsCtor = wsCtor ?? (globalThis.WebSocket as unknown as WebSocketConstructor);
    if (!this.wsCtor) throw new Error("[DepthManager] No WebSocket implementation.");
  }

  // ── PUBLIC API ──

  public async subscribe(symbol: string): Promise<void> {
    const ns = symbol.toUpperCase();
    const existing = this.symbolStates.get(ns);
    if (existing && existing.syncState !== DepthSyncState.DISCONNECTED) return;

    const state = new SymbolDepthState(ns, this.config);
    this.symbolStates.set(ns, state);
    state.syncState = DepthSyncState.AWAITING_SNAPSHOT;
    this.connectWebSocket(state);

    try {
      const snapshot = await this.fetchSnapshot(ns);
      this.applySnapshot(state, snapshot);
    } catch (err) {
      state.syncState = DepthSyncState.DISCONNECTED;
      this.emit("error", { symbol: ns, error: err instanceof Error ? err : new Error(String(err)), phase: "snapshot" });
      await this.retrySnapshot(state);
    }
    this.ensureStaleCheckTimer();
  }

  public unsubscribe(symbol: string): void {
    const state = this.symbolStates.get(symbol.toUpperCase());
    if (!state) return;
    state.hardDisconnect();
    state.syncState = DepthSyncState.DISCONNECTED;
    this.symbolStates.delete(symbol.toUpperCase());
    if (this.symbolStates.size === 0 && this.staleCheckTimerId !== null) {
      clearInterval(this.staleCheckTimerId);
      this.staleCheckTimerId = null;
    }
  }

  /**
   * DÜZELTME #5: Cached state döner, her çağrıda yeni obje oluşturmaz.
   * state.cachedDepthState mutate edilir, kopyalanmaz.
   */
  public getState(symbol: string): Readonly<DepthState> | null {
    return this.symbolStates.get(symbol.toUpperCase())?.getCachedState() ?? null;
  }

  public getAllStates(): Map<string, Readonly<DepthState>> {
    const result = new Map<string, Readonly<DepthState>>();
    for (const [symbol, state] of this.symbolStates) result.set(symbol, state.getCachedState());
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

  /**
   * Harici event işleme (FAZ 4 StreamMultiplexer entegrasyonu için).
   * StreamMultiplexer'dan gelen raw depth event'lerini doğrudan işler.
   */
  public processEvent(event: DepthUpdateEvent): void {
    const state = this.symbolStates.get(event.symbol.toUpperCase());
    if (!state) return;
    this.handleDepthEvent(state, event);
  }

  /** Order book Map'lerine doğrudan erişim (FAZ 1 OrderFlowEngine için) */
  public getBidsMap(symbol: string): ReadonlyMap<number, number> | null {
    return this.symbolStates.get(symbol.toUpperCase())?.bids ?? null;
  }

  public getAsksMap(symbol: string): ReadonlyMap<number, number> | null {
    return this.symbolStates.get(symbol.toUpperCase())?.asks ?? null;
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

  // ── REST SNAPSHOT ──

  private async fetchSnapshot(symbol: string, limit: number = 1000): Promise<DepthSnapshot> {
    const url = `${this.config.restBaseUrl}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetchFn(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };
      if (!data || typeof data.lastUpdateId !== "number") throw new Error("Invalid snapshot");
      return {
        lastUpdateId: data.lastUpdateId,
        bids: data.bids.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
        asks: data.asks.map(([p, q]) => ({ price: parseFloat(p), quantity: parseFloat(q) })),
      };
    } finally { clearTimeout(timeoutId); }
  }

  private async retrySnapshot(state: SymbolDepthState): Promise<void> {
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
      this.emit("resync", { symbol: state.symbol, reason: "snapshot_retry", attempt, graceful: false });
      await this.sleep(delay);
      try {
        const snapshot = await this.fetchSnapshot(state.symbol);
        this.applySnapshot(state, snapshot);
        return;
      } catch (err) {
        this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: `retry_${attempt}` });
      }
    }
    state.syncState = DepthSyncState.DISCONNECTED;
    this.emit("error", { symbol: state.symbol, error: new Error("All retries exhausted"), phase: "retry_exhausted" });
  }

  // ── SNAPSHOT APPLICATION ──

  private applySnapshot(state: SymbolDepthState, snapshot: DepthSnapshot): void {
    state.bids.clear();
    state.asks.clear();
    for (const level of snapshot.bids) { if (level.quantity > 0) state.bids.set(level.price, level.quantity); }
    for (const level of snapshot.asks) { if (level.quantity > 0) state.asks.set(level.price, level.quantity); }
    state.lastUpdateId = snapshot.lastUpdateId;
    state.snapshotTimestamp = Date.now();
    state.lastUpdateTimestamp = Date.now();

    // ── DÜZELTME #2: Graceful resync'te buffer'ı TEMİZLEME ──
    // Normal首次 sync'te buffer temizlenir, graceful resync'te korunur.
    if (state.syncState !== DepthSyncState.GRACEFUL_RESYNC) {
      state.bufferedEvents.length = 0;
    }

    state.syncState = DepthSyncState.BUFFERING;
    this.processBufferedEvents(state);
    state.updateBestPrices();
    if (state.bestBid > 0 && state.bestAsk > 0) {
      this.spreadAnalyzer.analyze(state.symbol, state.bestAsk, state.bestBid);
    }
    if ((state.syncState as DepthSyncState) === DepthSyncState.SYNCED) {
      this.emit("synced", state.getCachedState());
    }
  }

  // ── WEBSOCKET ──

  private connectWebSocket(state: SymbolDepthState): void {
    const url = `${this.config.wsBaseUrl}/${state.symbol.toLowerCase()}@depth@100ms`;
    try {
      const ws = new this.wsCtor(url);
      state.ws = ws;
      ws.onopen = () => {};
      ws.onmessage = (ev: { data: string }) => {
        try {
          const event = this.parseDepthEvent(JSON.parse(ev.data));
          if (event) this.handleDepthEvent(state, event);
        } catch (err) {
          console.error(`[DepthManager] Parse error ${state.symbol}:`, err);
        }
      };
      ws.onclose = (ev: { code: number; reason: string }) => {
        this.emit("disconnected", { symbol: state.symbol, code: ev.code, reason: ev.reason });
        if (state.shouldReconnect) {
          state.syncState = DepthSyncState.AWAITING_SNAPSHOT;
          setTimeout(() => {
            this.connectWebSocket(state);
            this.fetchSnapshot(state.symbol).then((s) => this.applySnapshot(state, s)).catch((err) => {
              this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "reconnect" });
            });
          }, this.config.retryDelayMs);
        }
      };
      ws.onerror = () => {
        this.emit("error", { symbol: state.symbol, error: new Error("WS error"), phase: "websocket" });
      };
    } catch (err) {
      this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "ws_connect" });
    }
  }

  private parseDepthEvent(raw: unknown): DepthUpdateEvent | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.e !== "depthUpdate") return null;
    const U = typeof o.U === "number" ? o.U : -1;
    const u = typeof o.u === "number" ? o.u : -1;
    const s = typeof o.s === "string" ? o.s : "";
    if (U < 0 || u < 0 || !s) return null;
    return {
      eventType: o.e as string, eventTime: typeof o.E === "number" ? o.E : 0,
      symbol: s, firstUpdateId: U, lastUpdateId: u,
      prevLastUpdateId: typeof o.pu === "number" ? o.pu : -1,
      bids: this.parseLevels(o.b), asks: this.parseLevels(o.a),
    };
  }

  private parseLevels(raw: unknown): OrderBookLevel[] {
    if (!Array.isArray(raw)) return [];
    const out: OrderBookLevel[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      out[i] = Array.isArray(e) && e.length >= 2
        ? { price: parseFloat(e[0]), quantity: parseFloat(e[1]) }
        : { price: 0, quantity: 0 };
    }
    return out;
  }

  // ── EVENT HANDLING (Core Algorithm) ──

  private handleDepthEvent(state: SymbolDepthState, event: DepthUpdateEvent): void {
    // ── DÜZELTME #2: GRACEFUL_RESYNC sırasında event'ler buffer'a yazılır, atılmaz ──
    if (state.syncState === DepthSyncState.AWAITING_SNAPSHOT ||
        state.syncState === DepthSyncState.GRACEFUL_RESYNC) {
      this.addToBuffer(state, event);
      return;
    }
    if (state.syncState === DepthSyncState.BUFFERING) {
      this.addToBuffer(state, event);
      this.processBufferedEvents(state);
      return;
    }
    if (state.syncState === DepthSyncState.SYNCED) {
      this.processSyncedEvent(state, event);
      return;
    }
    if (state.syncState === DepthSyncState.RESYNC_REQUIRED) {
      this.addToBuffer(state, event);
    }
  }

  /**
   * DÜZELTME #6: Buffer overflow koruması.
   * Buffer dolduğunda eski event'leri atmak yerine:
   * 1. Event rate'i hesapla
   * 2. Rate yüksekse buffer'ı geçici büyüt (max 2x)
   * 3. Hala doluyorsa en eski event'leri at ve gap flag koy
   */
  private addToBuffer(state: SymbolDepthState, event: DepthUpdateEvent): void {
    if (state.bufferedEvents.length >= state.currentMaxBuffer) {
      // ── Dinamik büyütme: event rate yüksekse buffer'ı 2x yap ──
      if (state.currentMaxBuffer < this.config.maxBufferSize * 2) {
        state.currentMaxBuffer = Math.min(state.currentMaxBuffer * 2, this.config.maxBufferSize * 2);
        console.warn(`[DepthManager] Buffer expanded to ${state.currentMaxBuffer} for ${state.symbol}`);
      }
      // ── Hala doluyorsa en eski event'i at, gap flag ──
      if (state.bufferedEvents.length >= state.currentMaxBuffer) {
        state.bufferedEvents.shift();
        state.bufferOverflowCount++;
      }
    }
    state.bufferedEvents.push(event);

    // ── Event rate tracking ──
    state.eventCountWindow++;
    const now = Date.now();
    if (now - state.eventRateWindowStart >= 1000) {
      state.eventsPerSecond = state.eventCountWindow;
      state.eventCountWindow = 0;
      state.eventRateWindowStart = now;
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
          this.emit("synced", state.getCachedState());
          continue;
        } else if (event.firstUpdateId > state.lastUpdateId) {
          if (event.firstUpdateId === state.lastUpdateId + 1) {
            this.applyEvent(state, event);
            toRemove.push(i);
            state.syncState = DepthSyncState.SYNCED;
            this.emit("synced", state.getCachedState());
            continue;
          }
          this.triggerGracefulResync(state, `Gap in buffer: U=${event.firstUpdateId}`);
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
      // ── DÜZELTME #2: Hard resync yerine graceful resync ──
      this.triggerGracefulResync(state, `Sequence gap: pu=${event.prevLastUpdateId} ≠ ${state.lastUpdateId}`);
      return;
    }
    this.applyEvent(state, event);
    this.emit("update", state.getCachedState());
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

  // ── DÜZELTME #2: GRACEFUL RESYNC ──
  // WS AÇIK KALIR. Snapshot yenilenir, buffer korunur, hizalanır.
  private triggerGracefulResync(state: SymbolDepthState, reason: string): void {
    state.syncState = DepthSyncState.GRACEFUL_RESYNC;
    state.resyncCount++;
    // ── Buffer TEMİZLENMEZ — WS'den gelen event'ler buffer'a yazılmaya devam eder ──
    this.emit("resync", { symbol: state.symbol, reason, attempt: state.resyncCount, graceful: true });

    // ── Timeout: Eğer graceful resync 5 saniyede tamamlanmazsa hard reset ──
    const timeoutId = setTimeout(() => {
      if (state.syncState === DepthSyncState.GRACEFUL_RESYNC) {
        console.warn(`[DepthManager] Graceful resync timeout for ${state.symbol}, forcing hard reset`);
        state.hardDisconnect();
        state.shouldReconnect = true;
        state.syncState = DepthSyncState.DISCONNECTED;
        setTimeout(() => this.subscribe(state.symbol), this.config.retryDelayMs);
      }
    }, this.config.gracefulResyncTimeoutMs);

    // ── Snapshot çek — WS açık kalmaya devam ediyor! ──
    this.fetchSnapshot(state.symbol)
      .then((snapshot) => {
        clearTimeout(timeoutId);
        if (state.syncState === DepthSyncState.GRACEFUL_RESYNC) {
          this.applySnapshot(state, snapshot);
          // ── Buffer boyutunu normale döndür ──
          state.currentMaxBuffer = this.config.maxBufferSize;
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        this.emit("error", { symbol: state.symbol, error: err instanceof Error ? err : new Error(String(err)), phase: "graceful_resync" });
        // ── Graceful başarısız, hard reset ──
        state.hardDisconnect();
        state.shouldReconnect = true;
        state.syncState = DepthSyncState.DISCONNECTED;
        setTimeout(() => this.subscribe(state.symbol), this.config.retryDelayMs);
      });
  }

  // ── DÜZELTME #3: DİNAMİK STALE CHECK ──
  private ensureStaleCheckTimer(): void {
    if (this.staleCheckTimerId !== null) return;
    this.staleCheckTimerId = setInterval(() => {
      const now = Date.now();
      for (const [symbol, state] of this.symbolStates) {
        if ((state.syncState as DepthSyncState) === DepthSyncState.SYNCED) {
          const elapsed = now - state.lastUpdateTimestamp;
          const threshold = this.getEffectiveStaleThreshold(symbol, state);
          if (elapsed > threshold) {
            state.syncState = DepthSyncState.STALE;
            this.emit("stale", { symbol, lastUpdateMs: elapsed, thresholdMs: threshold });
            this.triggerGracefulResync(state, `Stale: no update for ${elapsed}ms (threshold: ${threshold}ms)`);
          }
        }
      }
    }, 5000);
  }

  /**
   * DÜZELTME #3: Sembol bazlı + volatilite adaptif stale threshold.
   * Yüksek event rate → kısa threshold, düşük event rate → uzun threshold.
   */
  private getEffectiveStaleThreshold(symbol: string, state: SymbolDepthState): number {
    const config: StaleThresholdConfig = this.config.staleThresholds.get(symbol) ?? this.config.defaultStaleThreshold;
    // Event rate'e göre interpolasyon
    const eps = state.eventsPerSecond;
    if (eps >= config.volatilityBoundaryEps) {
      return config.highVolMs; // Yüksek volatilite → kısa tolerans
    }
    if (eps <= 0.5) {
      return config.lowVolMs; // Çok düşük volatilite → uzun tolerans
    }
    // Linear interpolation
    const ratio = eps / config.volatilityBoundaryEps;
    return config.lowVolMs + (config.highVolMs - config.lowVolMs) * ratio;
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  private emit<K extends keyof DepthManagerEvents>(event: K, data: DepthManagerEvents[K]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try { handler(data); } catch (err) {
          console.error(`[DepthManager] Handler error on '${String(event)}':`, err);
        }
      }
    }
  }
}

// ─────────────────────────────────────────────
// SYMBOL DEPTH STATE (GC-Optimized)
// ─────────────────────────────────────────────

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

  // ── DÜZELTME #6: Dynamic buffer ──
  public currentMaxBuffer: number;
  public bufferOverflowCount: number = 0;

  // ── Event rate tracking ──
  public eventsPerSecond: number = 0;
  public eventCountWindow: number = 0;
  public eventRateWindowStart: number = Date.now();

  /**
   * DÜZELTME #5: Cached DepthState objesi.
   * Her getCachedState() çağrısında yeni obje oluşturmaz,
   * mevcut objeyi günceller ve döner. GC baskısı minimum.
   */
  private _cached: DepthState;

  private readonly config: DepthManagerConfig;

  constructor(symbol: string, config: DepthManagerConfig) {
    this.symbol = symbol;
    this.config = config;
    this.currentMaxBuffer = config.maxBufferSize;
    // ── Pre-allocate cached state (tek sefer, GC-free) ──
    this._cached = {
      symbol, syncState: DepthSyncState.DISCONNECTED, lastUpdateId: -1,
      bestBid: 0, bestAsk: 0, spreadBps: 0,
      snapshotTimestamp: 0, lastUpdateTimestamp: 0,
      updateCount: 0, gapCount: 0, resyncCount: 0,
      bufferSize: 0, eventsPerSecond: 0, bidCount: 0, askCount: 0,
    };
  }

  /**
   * DÜZELTME #5: Her çağrıda obje oluşturmaz, mutate eder.
   * Readonly döner — dış kod mutation yapamaz (TypeScript enforced).
   */
  public getCachedState(): Readonly<DepthState> {
    const c = this._cached as DepthState;
    (c as { symbol: string }).symbol = this.symbol;
    (c as { syncState: DepthSyncState }).syncState = this.syncState;
    (c as { lastUpdateId: number }).lastUpdateId = this.lastUpdateId;
    (c as { bestBid: number }).bestBid = this.bestBid;
    (c as { bestAsk: number }).bestAsk = this.bestAsk;
    (c as { spreadBps: number }).spreadBps = this.spreadBps;
    (c as { snapshotTimestamp: number }).snapshotTimestamp = this.snapshotTimestamp;
    (c as { lastUpdateTimestamp: number }).lastUpdateTimestamp = this.lastUpdateTimestamp;
    (c as { updateCount: number }).updateCount = this.updateCount;
    (c as { gapCount: number }).gapCount = this.gapCount;
    (c as { resyncCount: number }).resyncCount = this.resyncCount;
    (c as { bufferSize: number }).bufferSize = this.bufferedEvents.length;
    (c as { eventsPerSecond: number }).eventsPerSecond = this.eventsPerSecond;
    (c as { bidCount: number }).bidCount = this.bids.size;
    (c as { askCount: number }).askCount = this.asks.size;
    return c;
  }

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

  public get spreadBps(): number {
    if (this.bestBid <= 0 || this.bestAsk <= 0) return 0;
    const mid = (this.bestAsk + this.bestBid) * 0.5;
    if (mid <= 0) return 0;
    return ((this.bestAsk - this.bestBid) / mid) * 10000;
  }

  public hardDisconnect(): void {
    this.shouldReconnect = false;
    if (this.ws) {
      try { if (this.ws.readyState === 1) this.ws.close(1000, "Unsubscribe"); } catch { /* ok */ }
      this.ws = null;
    }
  }
}
