/**
 * PREDATOR TERMINAL - FAZ 0: Public API
 * =======================================
 * Bu dosya, FAZ 0 modülünün tek giriş noktasıdır.
 */

export { SpreadAnalyzer } from "./SpreadAnalyzer";
export { DepthManager } from "./DepthManager";

export {
  // Enums
  SpreadStatus,
  SpreadAction,
  DepthSyncState,
  FlowEventType,
  SignalDirection,
  SignalConfidence,

  // Interfaces
  type SpreadResult,
  type SymbolThresholdConfig,
  type OrderBookLevel,
  type DepthSnapshot,
  type DepthUpdateEvent,
  type DepthState,
  type DepthManagerConfig,
  type StaleThresholdConfig,
  type DepthManagerEvents,
  type SpreadAnalyzerEvents,
  type OrderFlowEvents,
  type SignalEngineEvents,
  type TradeEvent,
  type FlowEvent,
  type SignalResult,
  type CVDSnapshot,
  type EventHandler,

  // Constants
  DEFAULT_DEPTH_CONFIG,
  DEFAULT_ORDER_FLOW_CONFIG,
  DEFAULT_SIGNAL_ENGINE_CONFIG,
} from "../shared/types";
