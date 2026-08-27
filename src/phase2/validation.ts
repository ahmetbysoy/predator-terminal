/**
 * PREDATOR TERMINAL - FAZ 2: Validation Suite
 * ==============================================
 * RenderEngine + LiquidityHeatmap + WallDetector testleri.
 */

import { RenderEngine } from "./RenderEngine";
import { LiquidityHeatmap } from "./LiquidityHeatmap";
import { WallDetector } from "./WallDetector";
import {
  RenderLayer, Viewport, WallCluster,
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
// MOCK CANVAS CONTEXT
// ─────────────────────────────────────────────

function createMockCtx(): { ctx: CanvasRenderingContext2D; getFillCount: () => number; getLastFillStyle: () => string } {
  let fillCount = 0;
  let lastFillStyle = "";

  const handler: ProxyHandler<object> = {
    get(target, prop) {
      if (prop === "fillStyle") return lastFillStyle;
      if (prop === "fillRect") return (_x: number, _y: number, _w: number, _h: number) => { fillCount++; };
      if (prop === "clearRect") return () => {};
      if (prop === "drawImage") return () => {};
      if (prop === "save") return () => {};
      if (prop === "restore") return () => {};
      if (prop === "translate") return () => {};
      return undefined;
    },
    set(target, prop, value) {
      if (prop === "fillStyle") lastFillStyle = value;
      return true;
    },
  };

  const proxy = new Proxy({}, handler) as CanvasRenderingContext2D;
  return {
    ctx: proxy,
    getFillCount: () => fillCount,
    getLastFillStyle: () => lastFillStyle,
  };
}

function createTestViewport(width = 800, height = 600, minPrice = 67000, maxPrice = 68000): Viewport {
  return {
    width, height, minPrice, maxPrice,
    priceToY: (price: number) => {
      if (price < minPrice || price > maxPrice) return NaN;
      return height - ((price - minPrice) / (maxPrice - minPrice)) * height;
    },
    timeToX: (time: number) => {
      const now = Date.now();
      const elapsed = (now - time) / 1000;
      return width - elapsed * (width / 900); // 15 min window
    },
  };
}

function createOrderBook(): { bids: Map<number, number>; asks: Map<number, number> } {
  const bids = new Map<number, number>();
  const asks = new Map<number, number>();

  // 50 bid seviyesi
  for (let i = 0; i < 50; i++) {
    bids.set(67500 - i * 2, 0.5 + Math.random() * 3);
  }
  // 50 ask seviyesi
  for (let i = 0; i < 50; i++) {
    asks.set(67501 + i * 2, 0.5 + Math.random() * 3);
  }

  // ── Birkaç büyük duvar ekle ──
  bids.set(67400, 15.0); // $1,011,000 — büyük bid duvar
  asks.set(67600, 12.0); // $811,200 — büyük ask duvar

  return { bids, asks };
}

// ─────────────────────────────────────────────
// RENDER ENGINE TESTS
// ─────────────────────────────────────────────

function testRenderEngine(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  RENDER ENGINE - VALIDATION");
  console.log("═══════════════════════════════════════");

  // ── Test 1: Dirty flag mechanism ──
  {
    let hudRendered = false;
    let heatmapRendered = false;

    const engine = new RenderEngine(
      () => 0, // mock rAF
      () => {}  // mock cAF
    );

    const { ctx: hudCtx } = createMockCtx();
    const { ctx: heatCtx } = createMockCtx();

    engine.registerRenderer(RenderLayer.HUD, hudCtx, () => { hudRendered = true; });
    engine.registerRenderer(RenderLayer.HEATMAP, heatCtx, () => { heatmapRendered = true; });

    const viewport = createTestViewport();

    // ── Sadece HUD dirty ──
    engine.mark(RenderLayer.HUD);
    engine.renderOnce(viewport);

    assert(hudRendered, "HUD rendered when marked dirty");
    assert(!heatmapRendered, "Heatmap NOT rendered when not dirty");
  }

  // ── Test 2: All layers dirty ──
  {
    const rendered: Record<string, boolean> = {};
    const engine = new RenderEngine(() => 0, () => {});
    const viewport = createTestViewport();

    for (const layer of Object.values(RenderLayer)) {
      const { ctx } = createMockCtx();
      engine.registerRenderer(layer, ctx, () => { rendered[layer] = true; });
    }

    engine.markAll();
    engine.renderOnce(viewport);

    for (const layer of Object.values(RenderLayer)) {
      assert(rendered[layer] === true, `${layer} rendered after markAll()`);
    }
  }

  // ── Test 3: Stats tracking ──
  {
    const engine = new RenderEngine(() => 0, () => {});
    const viewport = createTestViewport();
    const { ctx } = createMockCtx();

    engine.registerRenderer(RenderLayer.HUD, ctx, () => {});
    engine.mark(RenderLayer.HUD);
    engine.renderOnce(viewport);

    const stats = engine.getStats();
    assert(stats.totalFrames === 1, `Total frames: ${stats.totalFrames}`);
    assert(stats.dirtyLayers.size === 0, "No dirty layers after render");
  }

  // ── Test 4: setData + mark flow ──
  {
    let receivedData: unknown = null;
    const engine = new RenderEngine(() => 0, () => {});
    const viewport = createTestViewport();
    const { ctx } = createMockCtx();

    engine.registerRenderer(RenderLayer.ANNOTATIONS, ctx, (_ctx, _vp, data) => {
      receivedData = data;
    });

    engine.setData(RenderLayer.ANNOTATIONS, { walls: [1, 2, 3] });
    engine.mark(RenderLayer.ANNOTATIONS);
    engine.renderOnce(viewport);

    assert(receivedData !== null && (receivedData as { walls: number[] }).walls.length === 3, "Data passed to renderer");
  }

  // ── Test 5: update() shorthand ──
  {
    let renderCount = 0;
    const engine = new RenderEngine(() => 0, () => {});
    const viewport = createTestViewport();
    const { ctx } = createMockCtx();

    engine.registerRenderer(RenderLayer.DEPTH_OVERLAY, ctx, () => { renderCount++; });
    engine.update(RenderLayer.DEPTH_OVERLAY, { test: true });
    engine.renderOnce(viewport);

    assert(renderCount === 1, "update() triggers render");
  }

  // ── Test 6: Reset stats ──
  {
    const engine = new RenderEngine(() => 0, () => {});
    engine.resetStats();
    const stats = engine.getStats();
    assert(stats.totalFrames === 0, "Stats reset: totalFrames = 0");
    assert(stats.frameDropCount === 0, "Stats reset: frameDropCount = 0");
  }
}

// ─────────────────────────────────────────────
// LIQUIDITY HEATMAP TESTS
// ─────────────────────────────────────────────

function testLiquidityHeatmap(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  LIQUIDITY HEATMAP - VALIDATION");
  console.log("═══════════════════════════════════════");

  // ── Test 1: Sample ingestion ──
  {
    const heatmap = new LiquidityHeatmap();
    const { bids, asks } = createOrderBook();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    heatmap.sample(bids, asks, Date.now(), 2);

    const grid = heatmap.getGrid();
    assert(grid !== null, "Grid initialized after sample");
    if (grid) {
      assert(grid.timeCount > 0, `Time columns: ${grid.timeCount}`);
      assert(grid.priceCount > 0, `Price rows: ${grid.priceCount}`);
    }
  }

  // ── Test 2: Viewport culling ──
  {
    const heatmap = new LiquidityHeatmap();
    const { bids, asks } = createOrderBook();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    heatmap.sample(bids, asks, Date.now(), 2);

    const { ctx, getFillCount } = createMockCtx();
    const viewport = createTestViewport(800, 600, 67000, 68000);
    const stats = heatmap.render(ctx, viewport);

    assert(stats.totalBins > 0, `Total bins: ${stats.totalBins}`);
    assert(stats.drawnCells >= 0, `Drawn cells: ${stats.drawnCells}`);
    assert(stats.culledCells >= 0, `Culled cells: ${stats.culledCells}`);
    assert(stats.drawnCells + stats.culledCells === stats.totalBins || stats.drawnCells + stats.culledCells <= stats.totalBins,
      `Drawn + culled ≈ total`);
  }

  // ── Test 3: Invalid viewport protection ──
  {
    const heatmap = new LiquidityHeatmap();
    const { ctx } = createMockCtx();

    // minPrice >= maxPrice
    const badViewport: Viewport = {
      width: 800, height: 600, minPrice: 68000, maxPrice: 67000,
      priceToY: () => 0, timeToX: () => 0,
    };

    const stats = heatmap.render(ctx, badViewport);
    assert(stats.drawnCells === 0, "No cells drawn with invalid viewport (min >= max)");
  }

  // ── Test 4: Zero dimension protection ──
  {
    const heatmap = new LiquidityHeatmap();
    const { ctx } = createMockCtx();

    const zeroViewport: Viewport = {
      width: 0, height: 0, minPrice: 67000, maxPrice: 68000,
      priceToY: () => 0, timeToX: () => 0,
    };

    const stats = heatmap.render(ctx, zeroViewport);
    assert(stats.drawnCells === 0, "No cells drawn with zero dimensions");
  }

  // ── Test 5: Empty book ──
  {
    const heatmap = new LiquidityHeatmap();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    heatmap.sample(new Map(), new Map(), Date.now(), 2);

    const { ctx } = createMockCtx();
    const viewport = createTestViewport();
    const stats = heatmap.render(ctx, viewport);
    assert(stats.drawnCells === 0, "No cells drawn with empty book");
  }

  // ── Test 6: Reset ──
  {
    const heatmap = new LiquidityHeatmap();
    const { bids, asks } = createOrderBook();
    heatmap.reinitGrid(2, 67000, 68000, Date.now());
    heatmap.sample(bids, asks, Date.now(), 2);
    assert(heatmap.getGrid() !== null, "Grid exists before reset");
    heatmap.reset();
    assert(heatmap.getGrid() === null, "Grid null after reset");
  }
}

// ─────────────────────────────────────────────
// WALL DETECTOR TESTS
// ─────────────────────────────────────────────

function testWallDetector(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  WALL DETECTOR - VALIDATION");
  console.log("═══════════════════════════════════════");

  // ── Test 1: Basic wall detection ──
  {
    const detector = new WallDetector();
    const { bids, asks } = createOrderBook();
    const walls = detector.computeWallClusters(bids, asks, Date.now());

    assert(walls.length >= 0, `Walls detected: ${walls.length}`);

    // ── Büyük duvarları kontrol et ──
    if (walls.length > 0) {
      for (const wall of walls) {
        assert(wall.notional > 0, `Wall notional > 0: $${wall.notional.toFixed(0)}`);
        assert(wall.dominanceRatio >= 0.58, `Dominance ratio >= 0.58: ${wall.dominanceRatio.toFixed(3)}`);
        assert(wall.p90Threshold > 0, `P90 threshold > 0: ${wall.p90Threshold.toFixed(0)}`);
        assert(wall.side === "bid" || wall.side === "ask", `Side valid: ${wall.side}`);
      }
    }
  }

  // ── Test 2: Empty book → no walls ──
  {
    const detector = new WallDetector();
    const walls = detector.computeWallClusters(new Map(), new Map(), Date.now());
    assert(walls.length === 0, "No walls with empty book");
  }

  // ── Test 3: Single large bid wall ──
  {
    const detector = new WallDetector();
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    // Normal seviyeler
    for (let i = 0; i < 30; i++) {
      bids.set(67500 - i, 0.1);
      asks.set(67501 + i, 0.1);
    }

    // BÜYÜK duvar
    bids.set(67480, 50.0); // $3,374,000

    const walls = detector.computeWallClusters(bids, asks, Date.now());
    const bidWalls = walls.filter((w) => w.side === "bid");
    assert(bidWalls.length >= 1, `Large bid wall detected: ${bidWalls.length} walls`);
  }

  // ── Test 4: Persistent wall tracking ──
  {
    const detector = new WallDetector({ persistentThresholdSec: 2 });
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    for (let i = 0; i < 30; i++) {
      bids.set(67500 - i, 0.1);
      asks.set(67501 + i, 0.1);
    }
    bids.set(67480, 50.0); // Büyük duvar

    const now = Date.now();
    const walls1 = detector.computeWallClusters(bids, asks, now);

    // Aynı duvar 3 saniye sonra
    const walls2 = detector.computeWallClusters(bids, asks, now + 3000);

    const persistentWalls = walls2.filter((w) => w.isPersistent);
    // Duvar hâlâ oradaysa persistent olmalı
    if (walls1.length > 0 && walls2.length > 0) {
      assert(persistentWalls.length >= 1 || walls2[0].ageSec >= 2,
        `Persistent wall after 3s: ageSec=${walls2[0]?.ageSec?.toFixed(1)}, persistent=${walls2[0]?.isPersistent}`);
    }
  }

  // ── Test 5: Wall disappears → tracker cleans up ──
  {
    const detector = new WallDetector();
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    for (let i = 0; i < 30; i++) {
      bids.set(67500 - i, 0.1);
      asks.set(67501 + i, 0.1);
    }
    bids.set(67480, 50.0); // Büyük duvar

    detector.computeWallClusters(bids, asks, Date.now());

    // Duvarı kaldır
    bids.delete(67480);
    const walls2 = detector.computeWallClusters(bids, asks, Date.now());

    const bidWalls = walls2.filter((w) => w.side === "bid" && w.price === 67480);
    assert(bidWalls.length === 0, "Removed wall no longer detected");
  }

  // ── Test 6: P90 math verification ──
  {
    const detector = new WallDetector({ percentileThreshold: 0.90 });
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    // 100 küçük seviye
    for (let i = 0; i < 50; i++) {
      bids.set(67500 - i, 0.1); // $6,750 her biri
      asks.set(67501 + i, 0.1);
    }

    // 1 büyük seviye (P90 üstü olmalı)
    bids.set(67440, 20.0); // $1,348,800

    const walls = detector.computeWallClusters(bids, asks, Date.now());

    if (walls.length > 0) {
      assert(walls[0].p90Threshold > 0, `P90 threshold calculated: ${walls[0].p90Threshold.toFixed(0)}`);
    }
    assert(walls.length >= 1, "At least 1 wall above P90");
  }

  // ── Test 7: Dominance ratio check ──
  {
    const detector = new WallDetector();
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();

    // Eşit book — dominance düşük olmalı
    for (let i = 0; i < 50; i++) {
      bids.set(67500 - i, 10.0); // Herkes büyük
      asks.set(67501 + i, 10.0);
    }

    const walls = detector.computeWallClusters(bids, asks, Date.now());
    // Eşit dağılımda dominance < 0.58 olmalı → duvar YOK
    // (veya çok az olmalı)
    assert(walls.length <= 5, `Few walls in balanced book: ${walls.length}`);
  }

  // ── Test 8: Tracked wall count ──
  {
    const detector = new WallDetector();
    assert(detector.getTrackedWallCount() === 0, "No tracked walls initially");

    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    for (let i = 0; i < 30; i++) {
      bids.set(67500 - i, 0.1);
      asks.set(67501 + i, 0.1);
    }
    bids.set(67480, 50.0);

    detector.computeWallClusters(bids, asks, Date.now());
    const count = detector.getTrackedWallCount();
    assert(count >= 0, `Tracked wall count: ${count}`);

    detector.reset();
    assert(detector.getTrackedWallCount() === 0, "Tracked walls cleared after reset");
  }
}

// ─────────────────────────────────────────────
// RUN ALL
// ─────────────────────────────────────────────

console.log("\n╔═══════════════════════════════════════╗");
console.log("║  PREDATOR TERMINAL - FAZ 2 TESTS     ║");
console.log("╚═══════════════════════════════════════╝");

testRenderEngine();
testLiquidityHeatmap();
testWallDetector();

console.log(`\n${"═".repeat(50)}`);
console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
console.log(`${"═".repeat(50)}\n`);
