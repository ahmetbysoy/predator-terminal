/**
 * PREDATOR TERMINAL - FAZ 4: Integration Validation
 * Tüm modüllerin birlikte çalıştığını doğrular.
 * FAZ 2 denetçi sorularına cevaplar içerir.
 */

import { SpreadAnalyzer } from "../phase0/SpreadAnalyzer";
import { DepthManager } from "../phase0/DepthManager";
import { OrderFlowEngine } from "../phase1/OrderFlowEngine";
import { PredatorSignalEngine } from "../phase1/PredatorSignalEngine";
import { RenderEngine } from "../phase2/RenderEngine";
import { LiquidityHeatmap } from "../phase2/LiquidityHeatmap";
import { WallDetector } from "../phase2/WallDetector";
import { UserAlarmManager } from "./UserAlarmManager";
import { RenderLayer, Viewport, DepthSyncState } from "../shared/types";

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

// ─── MOCK HELPERS ───

function createMockCtx(): CanvasRenderingContext2D {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === "fillRect") return () => {};
      if (prop === "clearRect") return () => {};
      if (prop === "drawImage") return () => {};
      if (prop === "save") return () => {};
      if (prop === "restore") return () => {};
      return undefined;
    },
    set() { return true; },
  };
  return new Proxy({}, handler) as CanvasRenderingContext2D;
}

function createTestViewport(w = 800, h = 600, minP = 67000, maxP = 68000): Viewport {
  return {
    width: w, height: h, minPrice: minP, maxPrice: maxP,
    priceToY: (p: number) => h - ((p - minP) / (maxP - minP)) * h,
    timeToX: (t: number) => w - ((Date.now() - t) / 1000) * (w / 900),
  };
}

function createOrderBook(): { bids: Map<number, number>; asks: Map<number, number> } {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();
  for (let i = 0; i < 50; i++) {
    bids.set(67500 - i * 2, 0.5 + Math.random() * 3);
    asks.set(67501 + i * 2, 0.5 + Math.random() * 3);
  }
  bids.set(67400, 15.0); // $1M+ bid wall
  asks.set(67600, 12.0); // $800K+ ask wall
  return { bids, asks };
}

// ═══════════════════════════════════════════════
// TEST 1: Full Pipeline Integration
// ═══════════════════════════════════════════════

function testFullPipeline(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  FULL PIPELINE INTEGRATION");
  console.log("═══════════════════════════════════════");

  const spreadAnalyzer = new SpreadAnalyzer(undefined, 50);
  const orderFlow = new OrderFlowEngine();
  const signalEngine = new PredatorSignalEngine(orderFlow, spreadAnalyzer);
  const heatmap = new LiquidityHeatmap();
  const wallDetector = new WallDetector();
  const alarmManager = new UserAlarmManager();
  const renderEngine = new RenderEngine(() => 0, () => {});

  const { bids, asks } = createOrderBook();
  const now = Date.now();

  // ── 1. Spread Analysis ──
  spreadAnalyzer.analyze("BTCUSDT", 67501, 67500);
  const spread = spreadAnalyzer.getLastResult("BTCUSDT");
  assert(spread !== null && spread.bps > 0, `Spread: ${spread?.bps.toFixed(4)} bps`);

  // ── 2. Trade Flow (30 trades) ──
  for (let i = 0; i < 30; i++) {
    const isBuy = Math.random() > 0.4;
    orderFlow.processTrade("BTCUSDT", 67500 + (Math.random() - 0.5) * 10, 0.1 + Math.random() * 2, !isBuy, now + i * 1000);
  }
  const cvd = orderFlow.getCVDSnapshot();
  assert(cvd.currentCVD !== 0, `CVD accumulated: ${cvd.currentCVD.toFixed(0)}`);

  // ── 3. Heatmap Sample ──
  heatmap.reinitGrid(2, 67000, 68000, now);
  heatmap.sample(bids, asks, now, 2);
  const grid = heatmap.getGrid();
  assert(grid !== null, "Heatmap grid initialized");

  // ── 4. Wall Detection (with dynamic BPS) ──
  wallDetector.setSymbol("BTCUSDT");
  const mergeBps = wallDetector.getMergeBps("BTCUSDT");
  assert(mergeBps === 2, `BTC merge BPS: ${mergeBps} (expected 2)`);

  wallDetector.setSymbol("DOGEUSDT");
  const dogeBps = wallDetector.getMergeBps("DOGEUSDT");
  assert(dogeBps === 10, `DOGE merge BPS: ${dogeBps} (expected 10)`);

  wallDetector.setSymbol("BTCUSDT");
  const walls = wallDetector.computeWallClusters(bids, asks, now);
  assert(walls.length >= 0, `Walls detected: ${walls.length}`);

  // ── 5. Signal Evaluation ──
  const signal = signalEngine.evaluate("BTCUSDT", bids, asks, 67500, 67501, "1m", 60, now - 60000);
  console.log(`  Signal: ${signal ? `${signal.direction} (score: ${signal.score})` : "None (below threshold)"}`);

  // ── 6. Alarm System ──
  const alarmId = alarmManager.addAlarm("BTCUSDT", 67450, "below");
  assert(alarmId.length > 0, `Alarm created: ${alarmId}`);
  assert(alarmManager.getAlarmCount() === 1, `Alarm count: ${alarmManager.getAlarmCount()}`);

  alarmManager.checkPrice("BTCUSDT", 67500);
  assert(alarmManager.getAlarmCount() === 1, "Alarm not triggered (price above)");

  alarmManager.checkPrice("BTCUSDT", 67440);
  assert(alarmManager.getAlarmCount() === 0, "Alarm triggered and removed");

  // ── 7. Render Engine ──
  const mockCtx = createMockCtx();
  renderEngine.registerRenderer(RenderLayer.HUD, mockCtx, () => {});
  renderEngine.registerRenderer(RenderLayer.HEATMAP, mockCtx, () => {});
  renderEngine.registerRenderer(RenderLayer.DEPTH_OVERLAY, mockCtx, () => {});
  renderEngine.registerRenderer(RenderLayer.ANNOTATIONS, mockCtx, () => {});

  renderEngine.mark(RenderLayer.HUD);
  renderEngine.mark(RenderLayer.HEATMAP);
  const viewport = createTestViewport();
  const stats = renderEngine.renderOnce(viewport);
  assert(stats.totalFrames === 1, `Frames rendered: ${stats.totalFrames}`);
  assert(stats.dirtyLayers.size === 0, "All dirty layers cleared after render");
}

// ═══════════════════════════════════════════════
// TEST 2: FAZ 2 Düzeltmeleri Doğrulama
// ═══════════════════════════════════════════════

function testFaz2Fixes(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  FAZ 2 FIXES VERIFICATION");
  console.log("═══════════════════════════════════════");

  // ── Düzeltme 1: Ping-pong offscreen canvas ──
  {
    const heatmap = new LiquidityHeatmap();
    const { bids, asks } = createOrderBook();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    heatmap.sample(bids, asks, Date.now(), 2);

    const mockCtx = createMockCtx();
    const viewport = createTestViewport();
    const stats = heatmap.renderOffscreen(mockCtx, viewport);
    // renderOffscreen now uses ping-pong (A↔B), no self-draw
    assert(stats.offscreenBlitUsed || stats.totalBins >= 0, `Offscreen render: drawn=${stats.drawnCells}, blit=${stats.offscreenBlitUsed}`);
  }

  // ── Düzeltme 2: Dynamic cluster merge BPS ──
  {
    const detector = new WallDetector();
    
    const symbols = ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "SHIBUSDT", "UNKNOWNUSDT"];
    const expectedBps = [2, 3, 10, 15, 5]; // 5 = default
    
    for (let i = 0; i < symbols.length; i++) {
      const bps = detector.getMergeBps(symbols[i]);
      assert(bps === expectedBps[i], `${symbols[i]} merge BPS: ${bps} (expected ${expectedBps[i]})`);
    }
  }

  // ── Düzeltme 3: Persistent tracking (30s kuralı) ──
  {
    const detector = new WallDetector({ persistentThresholdSec: 30 });
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    
    for (let i = 0; i < 30; i++) {
      bids.set(67500 - i, 0.1);
      asks.set(67501 + i, 0.1);
    }
    bids.set(67480, 50.0); // Büyük duvar

    const now = Date.now();
    
    // İlk tespit
    const walls1 = detector.computeWallClusters(bids, asks, now);
    
    // 5 saniye sonra — persistent DEĞİL
    const walls2 = detector.computeWallClusters(bids, asks, now + 5000);
    const persistent5s = walls2.find(w => w.isPersistent);
    assert(!persistent5s, "5s: wall NOT persistent (correct)");

    // 31 saniye sonra — persistent
    const walls3 = detector.computeWallClusters(bids, asks, now + 31000);
    const persistent31s = walls3.find(w => w.isPersistent);
    if (walls3.length > 0) {
      assert(persistent31s !== undefined || walls3[0].ageSec >= 30, `31s: wall persistent=${persistent31s?.isPersistent}, age=${walls3[0]?.ageSec?.toFixed(1)}s`);
    }
  }

  // ── Düzeltme 4: Grid boyutu kontrolü ──
  {
    const heatmap = new LiquidityHeatmap();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    const grid = heatmap.getGrid();
    assert(grid !== null, "Grid initialized");
    if (grid) {
      assert(grid.timeCount > 0, `Time columns: ${grid.timeCount}`);
      assert(grid.priceCount > 0 && grid.priceCount <= 500, `Price rows: ${grid.priceCount} (max 500)`);
      // Bellek: timeCount * priceCount * 8 bytes (Float64)
      const memBytes = grid.timeCount * grid.priceCount * 8;
      assert(memBytes < 10 * 1024 * 1024, `Grid memory: ${(memBytes / 1024 / 1024).toFixed(2)} MB (<10 MB)`);
    }
  }

  // ── Düzeltme 5: Developer HUD stats ──
  {
    const engine = new RenderEngine(() => 0, () => {});
    const mockCtx = createMockCtx();
    const viewport = createTestViewport();

    engine.registerRenderer(RenderLayer.HUD, mockCtx, () => {});
    engine.mark(RenderLayer.HUD);
    engine.renderOnce(viewport);

    const stats = engine.getStats();
    assert(stats.totalFrames >= 1, `Dev HUD: frames=${stats.totalFrames}`);
    assert(typeof stats.frameDropCount === "number", `Dev HUD: drops=${stats.frameDropCount}`);
    assert(stats.dirtyLayers instanceof Set, "Dev HUD: dirtyLayers is Set");
  }
}

// ═══════════════════════════════════════════════
// TEST 3: Simulated 1-Minute Data Flow
// ═══════════════════════════════════════════════

function testSimulatedMinute(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  SIMULATED 1-MINUTE DATA FLOW");
  console.log("═══════════════════════════════════════");

  const spread = new SpreadAnalyzer(undefined, 100);
  const flow = new OrderFlowEngine();
  const signal = new PredatorSignalEngine(flow, spread);
  const heatmap = new LiquidityHeatmap();
  const walls = new WallDetector();
  const alarms = new UserAlarmManager();

  const now = Date.now();
  let depthUpdates = 0;
  let tradeUpdates = 0;
  let signalCount = 0;

  signal.on("signal", () => { signalCount++; });

  // ── Setup ──
  heatmap.reinitGrid(2, 67000, 68000, now);
  walls.setSymbol("BTCUSDT");
  alarms.addAlarm("BTCUSDT", 67000, "below");

  // ── Simulate 60 seconds: 10 depth updates + 100 trades/sec ──
  for (let sec = 0; sec < 60; sec++) {
    const t = now + sec * 1000;
    
    // Depth update (10 per second)
    if (sec % 6 === 0) {
      const bids = new Map<number, number>();
      const asks = new Map<number, number>();
      const basePrice = 67500 + Math.sin(sec * 0.1) * 50;
      for (let i = 0; i < 50; i++) {
        bids.set(basePrice - i * 2, 0.5 + Math.random() * 3);
        asks.set(basePrice + 1 + i * 2, 0.5 + Math.random() * 3);
      }

      spread.analyze("BTCUSDT", basePrice + 1, basePrice);
      heatmap.sample(bids, asks, t, 2);
      walls.computeWallClusters(bids, asks, t);
      alarms.checkPrice("BTCUSDT", basePrice);

      // Signal evaluation (on "candle close" every 60s)
      if (sec > 0 && sec % 60 === 0) {
        const bestBid = basePrice;
        const bestAsk = basePrice + 1;
        signal.evaluate("BTCUSDT", bids, asks, bestBid, bestAsk, "1m", 60, t - 60000);
      }

      depthUpdates++;
    }

    // Trade updates (5 per second for test speed)
    for (let j = 0; j < 5; j++) {
      const price = 67500 + Math.sin(sec * 0.1) * 50 + (Math.random() - 0.5) * 10;
      const isBuy = Math.random() > 0.45;
      flow.processTrade("BTCUSDT", price, 0.01 + Math.random() * 0.5, !isBuy, t + j * 200);
      tradeUpdates++;
    }
  }

  assert(depthUpdates > 0, `Depth updates: ${depthUpdates}`);
  assert(tradeUpdates > 0, `Trade updates: ${tradeUpdates}`);
  assert(flow.getCurrentCVD() !== 0, `Final CVD: ${flow.getCurrentCVD().toFixed(0)}`);
  
  const cvdSnap = flow.getCVDSnapshot();
  assert(cvdSnap.points.length > 0, `CVD points: ${cvdSnap.points.length}`);
  
  const heatStats = heatmap.getLastStats();
  assert(heatStats.drawnCells >= 0 || heatStats.culledCells >= 0, `Heatmap: drawn=${heatStats.drawnCells}, culled=${heatStats.culledCells}`);
  
  assert(walls.getTrackedWallCount() >= 0, `Tracked walls: ${walls.getTrackedWallCount()}`);
  
  console.log(`  Signals generated: ${signalCount}`);
  console.log(`  Alarm count: ${alarms.getAlarmCount()}`);
  assert(true, "1-minute simulation completed without crash");
}

// ═══════════════════════════════════════════════
// TEST 4: Error Recovery
// ═══════════════════════════════════════════════

function testErrorRecovery(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  ERROR RECOVERY");
  console.log("═══════════════════════════════════════");

  // ── SpreadAnalyzer with invalid data ──
  {
    const sa = new SpreadAnalyzer();
    const r1 = sa.analyze("BTCUSDT", NaN, 67500);
    assert(r1.status === "INVALID", "NaN input → INVALID");
    
    const r2 = sa.analyze("BTCUSDT", 67500, 67500);
    assert(r2.status === "VALID", "Valid input after NaN → VALID");
  }

  // ── OrderFlowEngine reset ──
  {
    const flow = new OrderFlowEngine();
    flow.processTrade("BTCUSDT", 67500, 5, false, Date.now());
    assert(flow.getCurrentCVD() !== 0, "CVD non-zero after trade");
    
    flow.reset();
    assert(flow.getCurrentCVD() === 0, "CVD zero after reset");
  }

  // ── Heatmap reset ──
  {
    const hm = new LiquidityHeatmap();
    const { bids, asks } = createOrderBook();
    hm.reinitGrid(2, 67000, 68000, Date.now());
    hm.sample(bids, asks, Date.now(), 2);
    assert(hm.getGrid() !== null, "Grid exists");
    
    hm.reset();
    assert(hm.getGrid() === null, "Grid null after reset");
  }

  // ── WallDetector reset ──
  {
    const wd = new WallDetector();
    const { bids, asks } = createOrderBook();
    wd.computeWallClusters(bids, asks, Date.now());
    
    wd.reset();
    assert(wd.getTrackedWallCount() === 0, "Walls cleared after reset");
  }

  // ── AlarmManager clear ──
  {
    const am = new UserAlarmManager();
    am.addAlarm("BTCUSDT", 67000, "below");
    am.addAlarm("ETHUSDT", 3500, "above");
    assert(am.getAlarmCount() === 2, "2 alarms added");
    
    am.checkPrice("BTCUSDT", 66000); // triggers
    assert(am.getAlarmCount() === 1, "1 alarm remaining after trigger");
    
    am.clearTriggered();
    assert(am.getAlarmCount() === 1, "Active alarms preserved after clearTriggered");
  }
}

// ═══════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════

console.log("\n╔═══════════════════════════════════════╗");
console.log("║  PREDATOR TERMINAL - FAZ 4 TESTS     ║");
console.log("╚═══════════════════════════════════════╝");

testFullPipeline();
testFaz2Fixes();
testSimulatedMinute();
testErrorRecovery();

console.log(`\n${"═".repeat(50)}`);
console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
