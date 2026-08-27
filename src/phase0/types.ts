/**
 * PREDATOR TERMINAL - FAZ 0 v2: Core Type Definitions
 * =====================================================
 * 6 Kritik Düzeltme Entegre:
 * 1. Stale threshold sembol-bazlı dinamik
 * 2. Buffer overflow → graceful degradation
 * 3. Throttle config spread analyzer'a eklendi
 * 4. DepthState doğrudan implement edilebilir yapıda
 * 5. Graceful resync state'leri eklendi
 * 6. GC-pressure azaltılmış snapshot pattern
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
  readonly firstUpdateId: number;
  readonly lastUpdateId: number;
  readonly prevLastUpdateId: number;
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
  /** Yeni: Graceful resync — WS açık kalır, snapshot yenilenir, buffer hizalanır */
  GRACEFUL_RESYNC = "GRACEFUL_RESYNC",
}

export interface DepthState {
  readonly symbol: string;
  readonly syncState: DepthSyncState;
  readonly lastUpdateId: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly spreadBps: number;
  readonly snapshotTimestamp: number;
  readonly lastUpdateTimestamp: number;
  readonly updateCount: number;
  readonly gapCount: number;
  readonly resyncCount: number;
  readonly bufferSize: number;
  readonly eventsPerSecond: number;
  /** Okuma amaçlı snapshot — mutation YASAK */
  readonly bidCount: number;
  readonly askCount: number;
}

export interface StaleThresholdConfig {
  /** Düşük volatilite: event gelmeme toleransı (ms) */
  readonly lowVolMs: number;
  /** Yüksek volatilite: event gelmeme toleransı (ms) */
  readonly highVolMs: number;
  /** Düşük/yüksek volatilite ayrım eşikleri (events/sec) */
  readonly volatilityBoundaryEps: number;
}

export interface DepthManagerConfig {
  readonly restBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly snapshotRefreshIntervalMs: number;
  readonly staleThresholds: Map<string, StaleThresholdConfig>;
  readonly defaultStaleThreshold: StaleThresholdConfig;
  readonly maxBufferSize: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly gracefulResyncTimeoutMs: number;
}

export const DEFAULT_STALE_THRESHOLD: StaleThresholdConfig = {
  lowVolMs: 30000,    // Düşük volatilite: 30 sn tolerans
  highVolMs: 5000,    // Yüksek volatilite: 5 sn tolerans
  volatilityBoundaryEps: 3, // 3 events/sec altı = düşük volatilite
};

export const SYMBOL_STALE_THRESHOLDS: ReadonlyMap<string, StaleThresholdConfig> = new Map([
  ["BTCUSDT",  { lowVolMs: 15000, highVolMs: 3000,  volatilityBoundaryEps: 5 }],
  ["ETHUSDT",  { lowVolMs: 20000, highVolMs: 4000,  volatilityBoundaryEps: 4 }],
  ["DOGEUSDT", { lowVolMs: 45000, highVolMs: 8000,  volatilityBoundaryEps: 2 }],
  ["SHIBUSDT", { lowVolMs: 60000, highVolMs: 10000, volatilityBoundaryEps: 1 }],
  ["PEPEUSDT", { lowVolMs: 45000, highVolMs: 8000,  volatilityBoundaryEps: 2 }],
]);

export const DEFAULT_DEPTH_CONFIG: DepthManagerConfig = {
  restBaseUrl: "https://api.binance.com",
  wsBaseUrl: "wss://stream.binance.com:9443/ws",
  snapshotRefreshIntervalMs: 30000,
  staleThresholds: new Map(SYMBOL_STALE_THRESHOLDS),
  defaultStaleThreshold: DEFAULT_STALE_THRESHOLD,
  maxBufferSize: 500,
  maxRetries: 5,
  retryDelayMs: 1000,
  gracefulResyncTimeoutMs: 5000,
};

// ─────────────────────────────────────────────
// ORDER FLOW TYPES (FAZ 1)
// ─────────────────────────────────────────────

export type TradeSide = "buy" | "sell";

export interface TradeEvent {
  readonly symbol: string;
  readonly price: number;
  readonly quantity: number;
  readonly notional: number;
  readonly side: TradeSide;
  readonly timestamp: number;
  readonly isWhale: boolean;
  readonly isAbsorption: boolean;
  readonly isSweep: boolean;
}

export interface CVDPoint {
  readonly timestamp: number;
  readonly cvd: number;
  readonly delta: number;
}

export interface CVDSnapshot {
  readonly currentCVD: number;
  readonly slope1m: number;
  readonly slope5m: number;
  readonly points: readonly CVDPoint[];
  readonly divergenceDetected: boolean;
}

export enum FlowEventType {
  WHALE = "WHALE",
  SWEEP = "SWEEP",
  ABSORPTION = "ABSORPTION",
  DELTA_BURST = "DELTA_BURST",
  SPOOF = "SPOOF",
  CVD_DIVERGENCE = "CVD_DIVERGENCE",
}

export interface FlowEvent {
  readonly type: FlowEventType;
  readonly side: TradeSide | null;
  readonly symbol: string;
  readonly price: number;
  readonly notional: number;
  readonly timestamp: number;
  readonly detail: string;
}

export interface OrderFlowConfig {
  readonly whaleThresholdNotional: number;
  readonly sweepWindowMs: number;
  readonly sweepMinPrints: number;
  readonly sweepMultiplier: number;
  readonly absorptionWindowMs: number;
  readonly absorptionDeltaMultiplier: number;
  readonly absorptionMaxPriceMovePct: number;
  readonly deltaBurstSlopeMultiplier: number;
  readonly spoofLifetimeMs: number;
  readonly spoofShrinkPct: number;
  readonly whaleCooldownMs: number;
  readonly cvdWindowSizeMs: number;
  readonly cvdSlopeWindowShort: number;
  readonly cvdSlopeWindowLong: number;
  readonly maxTradeBufferSize: number;
}

export const DEFAULT_ORDER_FLOW_CONFIG: OrderFlowConfig = {
  whaleThresholdNotional: 250000,
  sweepWindowMs: 1800,
  sweepMinPrints: 4,
  sweepMultiplier: 1.8,
  absorptionWindowMs: 10000,
  absorptionDeltaMultiplier: 2.2,
  absorptionMaxPriceMovePct: 0.035,
  deltaBurstSlopeMultiplier: 2.5,
  spoofLifetimeMs: 8000,
  spoofShrinkPct: 0.68,
  whaleCooldownMs: 1800,
  cvdWindowSizeMs: 3600000,
  cvdSlopeWindowShort: 60000,
  cvdSlopeWindowLong: 300000,
  maxTradeBufferSize: 10000,
};

// ─────────────────────────────────────────────
// SIGNAL ENGINE TYPES (FAZ 1)
// ─────────────────────────────────────────────

export enum SignalDirection {
  BUY = "BUY",
  SELL = "SELL",
}

export enum SignalConfidence {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export interface SignalResult {
  readonly id: string;
  readonly symbol: string;
  readonly direction: SignalDirection;
  readonly score: number;
  readonly confidence: SignalConfidence;
  readonly timestamp: number;
  readonly barTime: number;
  readonly interval: string;
  readonly intervalSec: number;
  readonly invalidationPrice: number;
  readonly invalidationReason: string;
  readonly modules: SignalModuleScores;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly spreadBps: number;
}

export interface SignalModuleScores {
  readonly liquidity: number;
  readonly flow: number;
  readonly spread: number;
  readonly total: number;
}

export interface SignalEngineConfig {
  readonly buyThreshold: number;
  readonly sellThreshold: number;
  readonly wLiquidity: number;
  readonly wFlow: number;
  readonly wSpread: number;
  readonly imbalanceThresholdPct: number;
  readonly maxImbalanceScore: number;
  readonly cvdSlopeScore: number;
  readonly highIntensityFlowScore: number;
  readonly spreadQualityBonus: number;
  readonly spreadQualityBpsThreshold: number;
  readonly signalCooldownMs: number;
  readonly maxSignalsBuffer: number;
}

export const DEFAULT_SIGNAL_ENGINE_CONFIG: SignalEngineConfig = {
  buyThreshold: 2.5,
  sellThreshold: -2.5,
  wLiquidity: 0.50,
  wFlow: 0.40,
  wSpread: 0.10,
  imbalanceThresholdPct: 25,
  maxImbalanceScore: 2.0,
  cvdSlopeScore: 1.5,
  highIntensityFlowScore: 1.0,
  spreadQualityBonus: 0.5,
  spreadQualityBpsThreshold: 3.0,
  signalCooldownMs: 5000,
  maxSignalsBuffer: 500,
};

// ─────────────────────────────────────────────
// EVENT TYPES
// ─────────────────────────────────────────────

export type EventHandler<T> = (data: T) => void;

export interface DepthManagerEvents {
  synced: DepthState;
  update: DepthState;
  gap: { symbol: string; expectedU: number; receivedU: number; gapSize: number };
  resync: { symbol: string; reason: string; attempt: number; graceful: boolean };
  error: { symbol: string; error: Error; phase: string };
  stale: { symbol: string; lastUpdateMs: number; thresholdMs: number };
  disconnected: { symbol: string; code: number; reason: string };
}

export interface SpreadAnalyzerEvents {
  spreadUpdate: SpreadResult;
  thresholdChanged: { symbol: string; oldConfig: SymbolThresholdConfig; newConfig: SymbolThresholdConfig };
}

export interface OrderFlowEvents {
  trade: TradeEvent;
  flowEvent: FlowEvent;
  cvdUpdate: CVDSnapshot;
  whaleDetected: FlowEvent;
  spoofDetected: FlowEvent;
}

export interface SignalEngineEvents {
  signal: SignalResult;
  signalExpired: { signal: SignalResult; reason: string };
}
