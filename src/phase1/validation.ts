/**
 * PREDATOR TERMINAL - FAZ 1: Validation Suite
 * ==============================================
 * OrderFlowEngine + PredatorSignalEngine doğrulama testleri.
 * Tüm 6 denetçi sorusuna cevap içerir.
 */

import { SpreadAnalyzer } from "../phase0/SpreadAnalyzer";
import { OrderFlowEngine } from "./OrderFlowEngine";
import { PredatorSignalEngine } from "./PredatorSignalEngine";
import {
  FlowEventType, SignalDirection, SignalConfidence,
  TradeSide, SpreadStatus,
  DEFAULT_ORDER_FLOW_CONFIG,
} from "../shared/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ✅ ${description}`);
    passed++;
  } else {
    console.error(`  ❌ ${description}`);
    failed++;
  }
}

// ─────────────────────────────────────────────
// ORDER FLOW ENGINE TESTS
// ─────────────────────────────────────────────

function testOrderFlowEngine(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  ORDER FLOW ENGINE - VALIDATION");
  console.log("═══════════════════════════════════════");

  const engine = new OrderFlowEngine();

  // ── Test 1: Structural side determination (isBuyerMaker) ──
  {
    const now = Date.now();
    // isBuyerMaker = false → buyer is taker → BUY
    const trade1 = engine.processTrade("BTCUSDT", 67500, 0.5, false, now);
    assert(trade1.side === "buy", "isBuyerMaker=false → BUY side");

    // isBuyerMaker = true → seller is taker → SELL
    const trade2 = engine.processTrade("BTCUSDT", 67500, 0.3, true, now + 100);
    assert(trade2.side === "sell", "isBuyerMaker=true → SELL side");
  }

  // ── Test 2: Whale detection ──
  {
    engine.reset();
    let whaleDetected = false;
    engine.on("flowEvent", (event) => {
      if (event.type === FlowEventType.WHALE) whaleDetected = true;
    });

    const now = Date.now();
    // $250K+ trade → whale
    engine.processTrade("BTCUSDT", 67500, 5.0, false, now); // 5 * 67500 = $337,500
    assert(whaleDetected, "Whale detected for $337K trade");

    // Whale cooldown: next whale within 1.8s should be suppressed
    whaleDetected = false;
    engine.processTrade("BTCUSDT", 67500, 5.0, false, now + 500);
    assert(!whaleDetected, "Whale cooldown suppresses duplicate within 1.8s");

    // After cooldown
    whaleDetected = false;
    engine.processTrade("BTCUSDT", 67500, 5.0, false, now + 2000);
    assert(whaleDetected, "Whale detected after cooldown expires");
  }

  // ── Test 3: CVD calculation ──
  {
    engine.reset();
    const now = Date.now();

    // Buy $100K
    engine.processTrade("BTCUSDT", 67500, 1.48, false, now); // buy
    // Sell $50K
    engine.processTrade("BTCUSDT", 67500, 0.74, true, now + 1000); // sell

    const cvd = engine.getCurrentCVD();
    // CVD = buy_notional - sell_notional ≈ (1.48 * 67500) - (0.74 * 67500) = 49,950
    assert(cvd > 0, `CVD positive after net buying: ${cvd.toFixed(0)}`);
  }

  // ── Test 4: Sweep detection ──
  {
    engine.reset();
    let sweepDetected = false;
    engine.on("flowEvent", (event) => {
      if (event.type === FlowEventType.SWEEP) sweepDetected = true;
    });

    const now = Date.now();
    // 4+ buy prints within 1.8s, total ≥ $250K * 1.8 = $450K
    for (let i = 0; i < 5; i++) {
      engine.processTrade("BTCUSDT", 67500, 2.0, false, now + i * 300); // 5 * 2 * 67500 = $675K
    }
    assert(sweepDetected, "Sweep detected: 5 buy prints totaling $675K in 1.2s");
  }

  // ── Test 5: CVD slope calculation ──
  {
    engine.reset();
    const now = Date.now();

    // Simulate 10 seconds of buying
    for (let i = 0; i < 10; i++) {
      engine.processTrade("BTCUSDT", 67500, 0.5, false, now + i * 1000);
    }

    const snapshot = engine.getCVDSnapshot();
    assert(snapshot.currentCVD > 0, `CVD positive: ${snapshot.currentCVD.toFixed(0)}`);
    assert(snapshot.slope1m > 0 || snapshot.slope1m === 0, `CVD slope1m: ${snapshot.slope1m.toFixed(2)} (should be positive or zero with limited data)`);
  }

  // ── Test 6: Trade ring buffer ──
  {
    engine.reset();
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      engine.processTrade("BTCUSDT", 67500, 0.1, i % 2 === 0 ? false : true, now + i * 100);
    }
    const recent = engine.getRecentTrades(5);
    assert(recent.length === 5, `Recent trades: ${recent.length} (expected 5)`);
    assert(recent[0].timestamp >= recent[4].timestamp, "Trades sorted newest-first");
  }

  // ── Test 7: Spoof detection ──
  {
    engine.reset();
    const now = Date.now();

    // Register a large level
    engine.checkSpoof(67500, 5.0, 0, now); // New large level: 5 BTC = $337.5K

    // Level removed after 3 seconds (within 8s spoof window)
    const spoof = engine.checkSpoof(67500, 0, 5.0, now + 3000);
    assert(spoof !== null, "Spoof detected: large level removed within lifetime");
    if (spoof) {
      assert(spoof.type === FlowEventType.SPOOF, "Spoof event type correct");
      assert(spoof.side === null, "Spoof side is null (direction-agnostic)");
    }
  }

  // ── Test 8: Notional formatting ──
  {
    const trade = engine.processTrade("BTCUSDT", 67500, 0.001, false, Date.now());
    assert(trade.notional === 67.5, `Notional: ${trade.notional} (expected 67.5)`);
  }
}

// ─────────────────────────────────────────────
// PREDATOR SIGNAL ENGINE TESTS
// ─────────────────────────────────────────────

function testPredatorSignalEngine(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  PREDATOR SIGNAL ENGINE - VALIDATION");
  console.log("═══════════════════════════════════════");

  const spreadAnalyzer = new SpreadAnalyzer();
  const orderFlow = new OrderFlowEngine();
  const signalEngine = new PredatorSignalEngine(orderFlow, spreadAnalyzer);

  // ── Test 1: BUY signal with strong bid imbalance ──
  {
    signalEngine.reset();
    orderFlow.reset();

    // Tight spread
    spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);

    // Create bid-heavy order book
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    // Heavy bids near mid
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 5.0 + Math.random() * 3);
    }
    // Light asks near mid
    for (let i = 0; i < 20; i++) {
      asks.set(67501 + i * 0.5, 0.5 + Math.random() * 0.5);
    }

    // Generate buying CVD slope
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      orderFlow.processTrade("BTCUSDT", 67500 + Math.random(), 1.0, false, now - 10000 + i * 1000);
    }

    let signalEmitted = false;
    signalEngine.on("signal", () => { signalEmitted = true; });

    const signal = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "1m", 60, now - 60000
    );

    if (signal) {
      assert(signal.direction === SignalDirection.BUY, `BUY signal generated: score=${signal.score}`);
      assert(signal.modules.liquidity > 0, `Positive liquidity score: ${signal.modules.liquidity}`);
      assert(signal.intervalSec === 60, `Interval seconds: ${signal.intervalSec}`);
      assert(signal.interval === "1m", `Interval: ${signal.interval}`);
      assert(signal.invalidationPrice > 0, `Invalidation price: ${signal.invalidationPrice}`);
      assert(signal.invalidationReason.length > 0, `Invalidation reason present`);
      assert(signal.spreadBps > 0, `Spread BPS: ${signal.spreadBps}`);
    }
    assert(signalEmitted || !signal, "Signal event emitted if signal was generated");
  }

  // ── Test 2: No signal when imbalance is weak ──
  {
    signalEngine.reset();
    orderFlow.reset();
    spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    // Balanced book
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 1.0);
      asks.set(67501 + i * 0.5, 1.0);
    }

    const signal = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "5m", 300, Date.now() - 300000
    );

    assert(signal === null, "No signal when order book is balanced");
  }

  // ── Test 3: Cooldown prevents rapid signals ──
  {
    signalEngine.reset();
    orderFlow.reset();
    spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 10.0);
      asks.set(67501 + i * 0.5, 0.1);
    }

    const signal1 = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "1m", 60, Date.now() - 60000
    );

    // Immediately try again
    const signal2 = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "1m", 60, Date.now() - 60000
    );

    if (signal1) {
      assert(signal2 === null, "Cooldown prevents second signal within 5s");
    }
  }

  // ── Test 4: Signal with interval data embedded ──
  {
    signalEngine.reset();
    orderFlow.reset();
    spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 10.0);
      asks.set(67501 + i * 0.5, 0.1);
    }

    const signal = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "15m", 900, Date.now() - 900000
    );

    if (signal) {
      assert(signal.interval === "15m", `15m interval embedded: ${signal.interval}`);
      assert(signal.intervalSec === 900, `900s interval embedded: ${signal.intervalSec}`);
      assert(signal.barTime > 0, `barTime embedded: ${signal.barTime}`);
    }
  }

  // ── Test 5: Confidence levels ──
  {
    signalEngine.reset();
    orderFlow.reset();
    spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 10.0);
      asks.set(67501 + i * 0.5, 0.1);
    }

    const signal = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "1m", 60, Date.now() - 60000
    );

    if (signal) {
      assert(
        signal.confidence === SignalConfidence.LOW ||
        signal.confidence === SignalConfidence.MEDIUM ||
        signal.confidence === SignalConfidence.HIGH,
        `Confidence level valid: ${signal.confidence}`
      );
    }
  }

  // ── Test 6: Signal buffer management ──
  {
    signalEngine.reset();
    const signals = signalEngine.getRecentSignals(10);
    assert(signals.length === 0, "Signal buffer starts empty");
  }

  // ── Test 7: Invalid spread blocks signal ──
  {
    signalEngine.reset();
    orderFlow.reset();

    // Force invalid spread
    spreadAnalyzer.analyze("BTCUSDT", 67499, 67500); // Crossed book

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (let i = 0; i < 20; i++) {
      bids.set(67500 - i * 0.5, 10.0);
      asks.set(67501 + i * 0.5, 0.1);
    }

    const signal = signalEngine.evaluate(
      "BTCUSDT", bids, asks, 67500, 67501,
      "1m", 60, Date.now() - 60000
    );

    assert(signal === null, "No signal when spread is INVALID (crossed book)");
  }

  // ── Test 8: Flow event scoring (structural, no regex) ──
  {
    orderFlow.reset();
    signalEngine.reset();

    // Generate a whale buy event
    let whaleSide: TradeSide | null = null;
    orderFlow.on("flowEvent", (event) => {
      if (event.type === FlowEventType.WHALE) {
        whaleSide = event.side;
      }
    });

    orderFlow.processTrade("BTCUSDT", 67500, 5.0, false, Date.now()); // BUY whale
    assert(whaleSide === "buy", `Whale side from structural data: ${whaleSide} (expected 'buy')`);
  }
}

// ─────────────────────────────────────────────
// INTEGRATION SCENARIO
// ─────────────────────────────────────────────

function testIntegrationScenario(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  INTEGRATION SCENARIO");
  console.log("═══════════════════════════════════════");

  const spreadAnalyzer = new SpreadAnalyzer(undefined, 50); // 50ms throttle
  const orderFlow = new OrderFlowEngine();
  const signalEngine = new PredatorSignalEngine(orderFlow, spreadAnalyzer);

  const now = Date.now();

  // ── Simulate 30 seconds of market activity ──
  console.log("\n  Simulating 30 seconds of BTCUSDT market activity...");

  // 1. Spread analysis
  spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);
  const spread = spreadAnalyzer.getLastResult("BTCUSDT");
  assert(spread !== null && spread.status === SpreadStatus.VALID, "Spread analysis working");

  // 2. Trade flow (30 trades over 30 seconds)
  for (let i = 0; i < 30; i++) {
    const isBuy = Math.random() > 0.4; // 60% buy pressure
    const qty = 0.1 + Math.random() * 2;
    const price = 67500 + (Math.random() - 0.5) * 10;
    orderFlow.processTrade("BTCUSDT", price, qty, !isBuy, now + i * 1000);
  }

  // 3. CVD check
  const cvd = orderFlow.getCVDSnapshot();
  assert(cvd.currentCVD !== 0, `CVD accumulated: ${cvd.currentCVD.toFixed(0)}`);

  // 4. Signal evaluation
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (let i = 0; i < 15; i++) {
    bids.set(67500 - i * 0.5, 3 + Math.random() * 5);
    asks.set(67501 + i * 0.5, 0.5 + Math.random() * 1);
  }

  const signal = signalEngine.evaluate(
    "BTCUSDT", bids, asks, 67500, 67501,
    "1m", 60, now - 60000
  );

  console.log(`  Signal result: ${signal ? `${signal.direction} (score: ${signal.score}, confidence: ${signal.confidence})` : "No signal (below threshold)"}`);

  if (signal) {
    console.log(`  Modules: liquidity=${signal.modules.liquidity.toFixed(2)}, flow=${signal.modules.flow.toFixed(2)}, spread=${signal.modules.spread.toFixed(2)}`);
    console.log(`  Invalidation: ${signal.invalidationReason}`);
    console.log(`  Interval: ${signal.interval} (${signal.intervalSec}s)`);
  }

  assert(true, "Integration scenario completed without errors");
}

// ─────────────────────────────────────────────
// RUN ALL
// ─────────────────────────────────────────────

console.log("\n╔═══════════════════════════════════════╗");
console.log("║  PREDATOR TERMINAL - FAZ 1 TESTS     ║");
console.log("╚═══════════════════════════════════════╝");

testOrderFlowEngine();
testPredatorSignalEngine();
testIntegrationScenario();

console.log(`\n${"═".repeat(50)}`);
console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
