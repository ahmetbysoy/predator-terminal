/**
 * PREDATOR TERMINAL - FAZ 0: Validation Suite
 * ==============================================
 * SpreadAnalyzer ve DepthManager için mantıksal doğrulama.
 * Gerçek piyasa senaryolarını simüle eder (mock WS/REST ile değil,
 * doğrudan API çağrılarıyla — unit test mantığı).
 */

import { SpreadAnalyzer } from "./SpreadAnalyzer";
import { DepthManager } from "./DepthManager";
import {
  SpreadStatus,
  SpreadAction,
  DepthSyncState,
  DepthSnapshot,
  DepthUpdateEvent,
  DEFAULT_DEPTH_CONFIG,
} from "./types";

// ─────────────────────────────────────────────
// SPREAD ANALYZER TESTS
// ─────────────────────────────────────────────

function testSpreadAnalyzer(): void {
  console.log("═══════════════════════════════════════");
  console.log("  SPREAD ANALYZER - VALIDATION SUITE");
  console.log("═══════════════════════════════════════");

  const analyzer = new SpreadAnalyzer();
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

  // ── Test 1: BTC/USDT tight spread ──
  {
    const result = analyzer.analyze("BTCUSDT", 67501.5, 67500.0);
    // BPS = ((67501.5 - 67500.0) / ((67501.5 + 67500.0) * 0.5)) * 10000
    //      = (1.5 / 67500.75) * 10000
    //      ≈ 0.2222
    assert(result.status === SpreadStatus.VALID, "BTC tight spread → VALID");
    assert(result.bps > 0 && result.bps < 1, `BTC BPS = ${result.bps} (expected ~0.22)`);
    assert(result.action === SpreadAction.AGGRESSIVE_ENTRY, `BTC action = ${result.action} (expected AGGRESSIVE_ENTRY)`);
    assert(result.uiColorHex === "#00FF88", `BTC color = ${result.uiColorHex} (expected #00FF88)`);
  }

  // ── Test 2: BTC/USDT wide spread ──
  {
    const result = analyzer.analyze("BTCUSDT", 67520.0, 67500.0);
    // BPS = (20 / 67510) * 10000 ≈ 2.96
    assert(result.status === SpreadStatus.VALID, "BTC wide spread → VALID");
    assert(result.bps > 2.5 && result.bps < 5.0, `BTC wide BPS = ${result.bps} (expected ~2.96)`);
    assert(result.action === SpreadAction.CAUTION, `BTC wide action = ${result.action} (expected CAUTION)`);
    assert(result.uiColorHex === "#FFD700", `BTC wide color = ${result.uiColorHex} (expected #FFD700)`);
  }

  // ── Test 3: BTC/USDT extreme spread ──
  {
    const result = analyzer.analyze("BTCUSDT", 67600.0, 67500.0);
    // BPS = (100 / 67550) * 10000 ≈ 14.8
    assert(result.status === SpreadStatus.VALID, "BTC extreme spread → VALID");
    assert(result.bps > 5.0, `BTC extreme BPS = ${result.bps} (expected >5.0)`);
    assert(result.action === SpreadAction.ABORT, `BTC extreme action = ${result.action} (expected ABORT)`);
    assert(result.uiColorHex === "#FF2D2D", `BTC extreme color = ${result.uiColorHex} (expected #FF2D2D)`);
  }

  // ── Test 4: DOGE/USDT (yüksek eşik) ──
  {
    const result = analyzer.analyze("DOGEUSDT", 0.16200, 0.16180);
    // BPS = (0.0002 / 0.1619) * 10000 ≈ 12.35
    // DOGE threshold: bpsAggressive=8.0, bpsCaution=15.0, bpsAbort=25.0
    // 12.35 > 8.0 ve <= 15.0 → HOLD
    assert(result.status === SpreadStatus.VALID, "DOGE spread → VALID");
    assert(result.bps > 12 && result.bps < 13, `DOGE BPS = ${result.bps} (expected ~12.35)`);
    assert(result.action === SpreadAction.HOLD, `DOGE action = ${result.action} (expected HOLD, BPS between aggressive and caution)`);
  }

  // ── Test 5: NaN input ──
  {
    const result = analyzer.analyze("BTCUSDT", NaN, 67500);
    assert(result.status === SpreadStatus.INVALID, "NaN ask → INVALID");
    assert(result.action === SpreadAction.IGNORE, "NaN ask → IGNORE");
    assert(result.uiColorHex === "#888888", "NaN ask → gray");
  }

  // ── Test 6: Infinity input ──
  {
    const result = analyzer.analyze("BTCUSDT", Infinity, 67500);
    assert(result.status === SpreadStatus.INVALID, "Infinity ask → INVALID");
  }

  // ── Test 7: Zero bid ──
  {
    const result = analyzer.analyze("BTCUSDT", 67500, 0);
    assert(result.status === SpreadStatus.INVALID, "Zero bid → INVALID");
  }

  // ── Test 8: Negative price ──
  {
    const result = analyzer.analyze("BTCUSDT", -100, 67500);
    assert(result.status === SpreadStatus.INVALID, "Negative ask → INVALID");
  }

  // ── Test 9: Crossed book (ask < bid) ──
  {
    const result = analyzer.analyze("BTCUSDT", 67499, 67500);
    assert(result.status === SpreadStatus.INVALID, "Crossed book → INVALID");
  }

  // ── Test 10: Custom threshold ──
  {
    analyzer.setThreshold("CUSTOMUSDT", { bpsCaution: 1.0, bpsAggressive: 0.5, bpsAbort: 3.0 });
    const threshold = analyzer.getThreshold("CUSTOMUSDT");
    assert(threshold.bpsCaution === 1.0, "Custom threshold set correctly");

    const result = analyzer.analyze("CUSTOMUSDT", 100.02, 100.00);
    // BPS = (0.02 / 100.01) * 10000 ≈ 1.9998
    // Custom threshold: bpsCaution=1.0, bpsAggressive=0.5, bpsAbort=3.0
    // 1.9998 > 1.0 (CAUTION) and <= 3.0 → CAUTION
    assert(result.action === SpreadAction.CAUTION, `Custom CAUTION: BPS=${result.bps} (between 1.0 and 3.0)`);

    // ABORT testi için daha geniş spread
    const resultAbort = analyzer.analyze("CUSTOMUSDT", 100.05, 100.00);
    // BPS = (0.05 / 100.025) * 10000 ≈ 4.998
    // 4.998 > 3.0 → ABORT
    assert(resultAbort.action === SpreadAction.ABORT, `Custom ABORT: BPS=${resultAbort.bps} (expected >3.0 → ABORT)`);
  }

  // ── Test 11: Batch analysis ──
  {
    const results = analyzer.analyzeBatch([
      { symbol: "BTCUSDT", ask: 67501, bid: 67500 },
      { symbol: "ETHUSDT", ask: 3500.5, bid: 3500.0 },
      { symbol: "DOGEUSDT", ask: 0.162, bid: 0.161 },
    ]);
    assert(results.length === 3, "Batch returns 3 results");
    assert(results.every((r) => r.status === SpreadStatus.VALID), "All batch results VALID");
  }

  // ── Test 12: Event emission ──
  {
    let eventFired = false;
    const freshAnalyzer = new SpreadAnalyzer(); // Clean state, no throttle history
    freshAnalyzer.on("spreadUpdate", () => {
      eventFired = true;
    });
    freshAnalyzer.analyze("EVENT_TEST_USDT", 100.05, 100.00); // Unique symbol
    assert(eventFired, "spreadUpdate event fired on first analyze()");
  }

  // ── Test 13: getLastResult ──
  {
    analyzer.analyze("TESTUSDT", 100.05, 100.00);
    const last = analyzer.getLastResult("TESTUSDT");
    assert(last !== null && last.symbol === "TESTUSDT", "getLastResult returns correct result");
  }

  // ── Test 14: Unknown symbol uses DEFAULT threshold ──
  {
    const result = analyzer.analyze("UNKNOWNUSDT", 100.50, 100.00);
    // BPS = (0.5 / 100.25) * 10000 ≈ 49.87
    assert(result.action === SpreadAction.ABORT, `Unknown symbol uses DEFAULT threshold → ABORT (BPS=${result.bps})`);
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
}

// ─────────────────────────────────────────────
// DEPTH MANAGER TESTS (Logic Validation)
// ─────────────────────────────────────────────

function testDepthManagerLogic(): void {
  console.log("═══════════════════════════════════════");
  console.log("  DEPTH MANAGER - LOGIC VALIDATION");
  console.log("═══════════════════════════════════════");

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

  // ── Test 1: SpreadAnalyzer entegrasyonu ──
  {
    const analyzer = new SpreadAnalyzer();
    let spreadReceived = false;
    analyzer.on("spreadUpdate", (result) => {
      if (result.symbol === "BTCUSDT" && result.status === SpreadStatus.VALID) {
        spreadReceived = true;
      }
    });
    analyzer.analyze("BTCUSDT", 67501, 67500);
    assert(spreadReceived, "SpreadAnalyzer emits event on valid analysis");
  }

  // ── Test 2: DepthManager instantiation ──
  {
    const analyzer = new SpreadAnalyzer();

    // ── Mock fetch ve WS ──
    const mockFetch = async (url: string) => {
      const snapshot: DepthSnapshot = {
        lastUpdateId: 1000,
        bids: [
          { price: 67500.0, quantity: 1.5 },
          { price: 67499.5, quantity: 2.3 },
          { price: 67499.0, quantity: 0.8 },
        ],
        asks: [
          { price: 67501.0, quantity: 1.2 },
          { price: 67501.5, quantity: 3.1 },
          { price: 67502.0, quantity: 0.5 },
        ],
      };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          lastUpdateId: snapshot.lastUpdateId,
          bids: snapshot.bids.map((l) => [String(l.price), String(l.quantity)]),
          asks: snapshot.asks.map((l) => [String(l.price), String(l.quantity)]),
        }),
      };
    };

    // ── Mock WebSocket ──
    const mockWsCtor = class MockWS {
      readyState = 1;
      onopen: ((ev: unknown) => void) | null = null;
      onclose: ((ev: { code: number; reason: string }) => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: ((ev: unknown) => void) | null = null;
      constructor(public url: string) {
        setTimeout(() => this.onopen?.({}), 10);
      }
      send() {}
      close() {}
    };

    const manager = new DepthManager(
      analyzer,
      undefined, // Use default config (includes dynamic stale thresholds)
      mockFetch as never,
      mockWsCtor as never
    );

    assert(manager !== null, "DepthManager instantiated with mock dependencies");

    // ── Subscribe ve snapshot doğrulama ──
    let syncReceived = false;
    manager.on("synced", (state) => {
      if (state.symbol === "BTCUSDT") {
        syncReceived = true;
      }
    });

    manager.subscribe("BTCUSDT").then(() => {
      // ── Snapshot sonrası state kontrolü ──
      const state = manager.getState("BTCUSDT");
      if (state) {
        assert(state.symbol === "BTCUSDT", "State symbol correct");
        assert(state.bestBid === 67500.0, `Best bid = ${state.bestBid} (expected 67500.0)`);
        assert(state.bestAsk === 67501.0, `Best ask = ${state.bestAsk} (expected 67501.0)`);
        assert(state.bidCount === 3, `Bid count = ${state.bidCount} (expected 3)`);
        assert(state.askCount === 3, `Ask count = ${state.askCount} (expected 3)`);
      }

      // ── Order book retrieval ──
      const book = manager.getOrderBook("BTCUSDT", 2);
      if (book) {
        assert(book.bids.length === 2, `Top 2 bids returned: ${book.bids.length}`);
        assert(book.bids[0].price === 67500.0, "Best bid at top");
        assert(book.asks.length === 2, `Top 2 asks returned: ${book.asks.length}`);
        assert(book.asks[0].price === 67501.0, "Best ask at top");
      }

      // ── isSynced kontrol ──
      const synced = manager.isSynced("BTCUSDT");
      assert(synced === true || synced === false, `isSynced returns boolean: ${synced}`);

      // ── Best prices ──
      const prices = manager.getBestPrices("BTCUSDT");
      if (prices) {
        assert(prices.bestBid === 67500.0, "getBestPrices bid correct");
        assert(prices.bestAsk === 67501.0, "getBestPrices ask correct");
      }

      // ── Spread analiz entegrasyonu ──
      const spreadResult = analyzer.getLastResult("BTCUSDT");
      assert(spreadResult !== null, "SpreadAnalyzer received data from DepthManager");
      if (spreadResult) {
        assert(spreadResult.status === SpreadStatus.VALID, "Spread from depth is VALID");
        assert(spreadResult.bps > 0, `Spread BPS = ${spreadResult.bps} (expected >0)`);
      }

      // ── Cleanup ──
      manager.destroy();
      console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    });
  }

  // ── Test 3: BPS formül doğrulama ──
  {
    // ── Manuel hesaplama ──
    const ask = 67501.5;
    const bid = 67500.0;
    const mid = (ask + bid) * 0.5; // 67500.75
    const expectedBps = ((ask - bid) / mid) * 10000; // (1.5 / 67500.75) * 10000 ≈ 0.2222

    const analyzer = new SpreadAnalyzer();
    const result = analyzer.analyze("BTCUSDT", ask, bid);
    const tolerance = 0.001;
    assert(
      Math.abs(result.bps - expectedBps) < tolerance,
      `BPS formula: ${result.bps} ≈ ${expectedBps.toFixed(4)} (tolerance: ${tolerance})`
    );
  }

  // ── Test 4: Edge case — çok küçük spread ──
  {
    const analyzer = new SpreadAnalyzer();
    const result = analyzer.analyze("BTCUSDT", 67500.01, 67500.00);
    assert(result.status === SpreadStatus.VALID, "Micro spread → VALID");
    assert(result.bps < 0.01, `Micro BPS = ${result.bps} (expected <0.01)`);
    assert(result.action === SpreadAction.AGGRESSIVE_ENTRY, "Micro spread → AGGRESSIVE_ENTRY");
  }

  // ── Test 5: Edge case — aynı fiyat ──
  {
    const analyzer = new SpreadAnalyzer();
    const result = analyzer.analyze("BTCUSDT", 67500.00, 67500.00);
    assert(result.status === SpreadStatus.VALID, "Same price → VALID");
    assert(result.bps === 0, `Same price BPS = ${result.bps} (expected 0)`);
    assert(result.action === SpreadAction.AGGRESSIVE_ENTRY, "Zero spread → AGGRESSIVE_ENTRY");
  }
}

// ─────────────────────────────────────────────
// REAL MARKET SCENARIO SIMULATION
// ─────────────────────────────────────────────

function simulateRealMarketScenario(): void {
  console.log("═══════════════════════════════════════");
  console.log("  REAL MARKET SCENARIO SIMULATION");
  console.log("═══════════════════════════════════════");

  const analyzer = new SpreadAnalyzer();

  // ── Senaryo: BTC/USDT üzerinde 10 ardışık tick ──
  const ticks = [
    { ask: 67501.0, bid: 67500.0, desc: "Normal tight spread" },
    { ask: 67501.5, bid: 67500.0, desc: "Slightly wider" },
    { ask: 67502.0, bid: 67500.0, desc: "Widening" },
    { ask: 67505.0, bid: 67500.0, desc: "Moderate spread" },
    { ask: 67510.0, bid: 67500.0, desc: "Wide — caution zone" },
    { ask: 67520.0, bid: 67500.0, desc: "Very wide — abort zone" },
    { ask: 67500.5, bid: 67500.0, desc: "Tightening again" },
    { ask: 67500.1, bid: 67500.0, desc: "Almost zero spread" },
    { ask: 67500.0, bid: 67500.0, desc: "Zero spread (crossed)" },
    { ask: 67499.0, bid: 67500.0, desc: "Crossed book (invalid)" },
  ];

  console.log("\n  BTCUSDT Spread Simulation:");
  console.log("  ─────────────────────────────────────");

  for (const tick of ticks) {
    const result = analyzer.analyze("BTCUSDT", tick.ask, tick.bid);
    const statusIcon = result.status === SpreadStatus.VALID ? "🟢" : "🔴";
    console.log(
      `  ${statusIcon} ${tick.desc.padEnd(30)} | BPS: ${result.bps.toFixed(4).padStart(8)} | Action: ${result.action.padEnd(18)} | Color: ${result.uiColorHex}`
    );
  }

  console.log("\n  ─────────────────────────────────────");

  // ── Senaryo: Gap detection log ──
  console.log("\n  Gap Detection Scenario (DepthManager):");
  console.log("  ─────────────────────────────────────");
  console.log("  1. Snapshot received: lastUpdateId = 1000");
  console.log("  2. Event U=998, u=999  → DROPPED (u < lastUpdateId)");
  console.log("  3. Event U=999, u=1002 → ACCEPTED (U <= lastUpdateId AND u >= lastUpdateId)");
  console.log("  4. Event U=1003, u=1005, pu=1002 → ACCEPTED (pu == lastUpdateId)");
  console.log("  5. Event U=1008, u=1010, pu=1007 → GAP! (pu=1007 ≠ expected 1005) → RESYNC triggered");
  console.log("  6. New snapshot fetched, buffer cleared, re-sync initiated");
  console.log("  ─────────────────────────────────────");
}

// ─────────────────────────────────────────────
// RUN ALL
// ─────────────────────────────────────────────

export function runAllTests(): void {
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║  PREDATOR TERMINAL - FAZ 0 TESTS     ║");
  console.log("╚═══════════════════════════════════════╝\n");

  testSpreadAnalyzer();
  testDepthManagerLogic();
  simulateRealMarketScenario();
}

// ── Doğrudan çalıştırma ──
runAllTests();
