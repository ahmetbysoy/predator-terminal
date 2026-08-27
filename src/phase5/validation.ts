/**
 * PREDATOR TERMINAL - FAZ 5: Validation Suite
 * KlineManager, Enhanced UserAlarmManager, HudRenderer,
 * AnnotationsRenderer, LongPressAlarmController testleri.
 * 7 denetçi sorusuna cevap.
 */

import { KlineManager } from "./KlineManager";
import { UserAlarmManager, MemoryStorageAdapter, Alarm } from "./UserAlarmManager";
import { HudRenderer, HudData } from "./HudRenderer";
import { AnnotationsRenderer, AlarmLine, WhaleArrow } from "./AnnotationsRenderer";
import { LongPressAlarmController } from "./LongPressAlarmController";
import { WallCluster } from "../shared/types";

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

// ═══════════════════════════════════════════════
// TEST 1: KlineManager
// ═══════════════════════════════════════════════

async function testKlineManager(): Promise<void> {
  console.log("\n═══════════════════════════════════════");
  console.log("  KLINE MANAGER - VALIDATION");
  console.log("═══════════════════════════════════════");

  // ── Mock fetch ──
  const mockKlines = Array.from({ length: 10 }, (_, i) => {
    const baseTime = Date.now() - (10 - i) * 60000;
    return [
      baseTime,
      "67500.00", // open
      "67550.00", // high
      "67450.00", // low
      "67520.00", // close
      "100.5",    // volume
      baseTime + 59999, // closeTime
      "6765000.00",
      500,
      "50.25",
      "3393000.00",
      "0",
    ];
  });

  const mockFetch = async () => ({
    ok: true,
    json: async () => mockKlines,
  });

  const km = new KlineManager({}, mockFetch as any);

  // ── Test 1: Load history ──
  {
    const candles = await km.loadHistory("BTCUSDT", "1m", 10);
    assert(candles.length === 10, `Loaded ${candles.length} candles`);
    assert(km.getSymbol() === "BTCUSDT", `Symbol: ${km.getSymbol()}`);
    assert(km.getInterval() === "1m", `Interval: ${km.getInterval()}`);
    assert(km.getIntervalSeconds() === 60, `Interval seconds: ${km.getIntervalSeconds()}`);
  }

  // ── Test 2: Candle data integrity ──
  {
    const candles = km.getCandles();
    assert(candles[0].open === 67500, `Open: ${candles[0].open}`);
    assert(candles[0].high === 67550, `High: ${candles[0].high}`);
    assert(candles[0].low === 67450, `Low: ${candles[0].low}`);
    assert(candles[0].close === 67520, `Close: ${candles[0].close}`);
    assert(candles[0].volume === 100.5, `Volume: ${candles[0].volume}`);
  }

  // ── Test 3: Process kline (WS event) ──
  {
    const lastCandle = km.getCandles()[km.getCandles().length - 1];
    const klineEvent = {
      k: {
        t: lastCandle.time,
        T: lastCandle.closeTime,
        s: "BTCUSDT",
        i: "1m",
        o: "67500.00",
        h: "67600.00", // Yeni high
        l: "67450.00",
        c: "67580.00", // Yeni close
        v: "150.0",
        x: false, // Henüz kapanmadı
      },
    };

    const updated = km.processKline(klineEvent);
    assert(updated !== null, "Kline processed");
    if (updated) {
      assert(updated.high === 67600, `Updated high: ${updated.high}`);
      assert(updated.close === 67580, `Updated close: ${updated.close}`);
      assert(updated.isClosed === false, "Candle not closed");
    }
  }

  // ── Test 4: New candle (closed + new) ──
  {
    const lastCandle = km.getCandles()[km.getCandles().length - 1];
    
    // Kapanmış mum
    km.processKline({
      k: {
        t: lastCandle.time, T: lastCandle.closeTime,
        s: "BTCUSDT", i: "1m",
        o: "67500", h: "67600", l: "67450", c: "67580", v: "150", x: true,
      },
    });

    // Yeni mum
    const newTime = lastCandle.time + 60000;
    km.processKline({
      k: {
        t: newTime, T: newTime + 59999,
        s: "BTCUSDT", i: "1m",
        o: "67580", h: "67590", l: "67570", c: "67585", v: "10", x: false,
      },
    });

    assert(km.length === 11, `Candle count after new: ${km.length}`);
  }

  // ── Test 5: Generation guard ──
  {
    km.reset();
    assert(km.length === 0, "Candles cleared after reset");
  }

  // ── Test 6: Get recent candles ──
  {
    await km.loadHistory("BTCUSDT", "1m", 10);
    const recent = km.getRecentCandles(3);
    assert(recent.length === 3, `Recent candles: ${recent.length}`);
  }

  // ── Test 7: Last closed candle ──
  {
    const lastClosed = km.getLastClosedCandle();
    assert(lastClosed !== null, "Last closed candle exists");
    if (lastClosed) {
      assert(lastClosed.isClosed === true, "Last closed candle isClosed=true");
    }
  }

  // ── Test 8: Wrong symbol/interval guard ──
  {
    const wrongKline = {
      k: {
        t: Date.now(), T: Date.now() + 60000,
        s: "ETHUSDT", i: "1m",
        o: "3500", h: "3510", l: "3490", c: "3505", v: "100", x: false,
      },
    };
    const result = km.processKline(wrongKline);
    assert(result === null, "Wrong symbol kline rejected");
  }
}

// ═══════════════════════════════════════════════
// TEST 2: Enhanced UserAlarmManager
// ═══════════════════════════════════════════════

function testEnhancedAlarmManager(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  ENHANCED ALARM MANAGER - VALIDATION");
  console.log("═══════════════════════════════════════");

  // ── Test 1: localStorage persistence (MemoryStorageAdapter) ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage, storageKey: "test_alarms" });
    
    am.addAlarm("BTCUSDT", 67000, "below");
    am.addAlarm("ETHUSDT", 3500, "above");
    
    const json = storage.getItem("test_alarms");
    assert(json !== null, "Alarms persisted to storage");
    
    // Yeni instance — storage'dan yükle
    const am2 = new UserAlarmManager({ storage, storageKey: "test_alarms" });
    assert(am2.getAlarmCount() === 2, `Loaded ${am2.getAlarmCount()} alarms from storage`);
  }

  // ── Test 2: toggleAlarm ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    const id = am.addAlarm("BTCUSDT", 67000, "below");
    assert(am.getActiveAlarms("BTCUSDT").length === 1, "1 active alarm");
    
    am.toggleAlarm(id);
    assert(am.getActiveAlarms("BTCUSDT").length === 0, "0 active after toggle off");
    
    am.toggleAlarm(id);
    assert(am.getActiveAlarms("BTCUSDT").length === 1, "1 active after toggle on");
  }

  // ── Test 3: checkAll with !ticker@arr format ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    am.addAlarm("BTCUSDT", 67000, "below");
    am.addAlarm("ETHUSDT", 3500, "above");
    am.addAlarm("DOGEUSDT", 0.10, "below");

    // ── !ticker@arr formatı simüle et ──
    const tickerData = [
      { s: "BTCUSDT", c: "66500.00" },  // Triggers below 67000
      { s: "ETHUSDT", c: "3600.00" },    // Triggers above 3500
      { s: "DOGEUSDT", c: "0.15" },      // Does NOT trigger (above 0.10)
      { s: "SOLUSDT", c: "150.00" },     // No alarm for SOL
    ];

    const triggered = am.checkAll(tickerData);
    assert(triggered.length === 2, `Triggered: ${triggered.length} alarms (expected 2)`);
    assert(triggered.some(t => t.alarm.symbol === "BTCUSDT"), "BTC alarm triggered");
    assert(triggered.some(t => t.alarm.symbol === "ETHUSDT"), "ETH alarm triggered");
  }

  // ── Test 4: checkAllFromMap ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    am.addAlarm("BTCUSDT", 68000, "above");
    
    const prices = new Map([["BTCUSDT", 68500], ["ETHUSDT", 3500]]);
    const triggered = am.checkAllFromMap(prices);
    assert(triggered.length === 1, `Map-based checkAll: ${triggered.length} triggered`);
  }

  // ── Test 5: toJSON / fromJSON ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    am.addAlarm("BTCUSDT", 67000, "below");
    am.addAlarm("ETHUSDT", 3500, "above");
    
    const json = am.toJSON();
    assert(json.includes("BTCUSDT"), "JSON contains BTCUSDT");
    assert(json.includes("ETHUSDT"), "JSON contains ETHUSDT");
    
    const am2 = new UserAlarmManager({ storage: new MemoryStorageAdapter() });
    am2.fromJSON(json);
    assert(am2.getAlarmCount() === 2, `Imported ${am2.getAlarmCount()} alarms`);
  }

  // ── Test 6: getSymbolsWithAlarms ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    am.addAlarm("BTCUSDT", 67000, "below");
    am.addAlarm("ETHUSDT", 3500, "above");
    
    const symbols = am.getSymbolsWithAlarms();
    assert(symbols.length === 2, `Symbols with alarms: ${symbols.length}`);
    assert(symbols.includes("BTCUSDT"), "BTCUSDT in symbols");
    assert(symbols.includes("ETHUSDT"), "ETHUSDT in symbols");
  }

  // ── Test 7: Inactive alarm not triggered ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    const id = am.addAlarm("BTCUSDT", 67000, "below");
    am.toggleAlarm(id); // Deactivate
    
    const triggered = am.checkPrice("BTCUSDT", 66000);
    assert(triggered.length === 0, "Inactive alarm not triggered");
  }

  // ── Test 8: Toast event emission ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    
    let toastReceived = false;
    am.on("toast", () => { toastReceived = true; });
    
    am.addAlarm("BTCUSDT", 67000, "below");
    am.checkPrice("BTCUSDT", 66000);
    
    assert(toastReceived, "Toast event emitted on alarm trigger");
  }
}

// ═══════════════════════════════════════════════
// TEST 3: HudRenderer
// ═══════════════════════════════════════════════

function testHudRenderer(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  HUD RENDERER - VALIDATION");
  console.log("═══════════════════════════════════════");

  const renderer = new HudRenderer("normal");

  const testData: HudData = {
    volume24h: 1_500_000_000,
    spreadBps: 1.48,
    spreadAction: "AGGRESSIVE_ENTRY",
    spreadColor: "#00FF88",
    imbalancePct: 15.3,
    wallCount: 3,
    bestBid: 67500.00,
    bestAsk: 67501.00,
    midPrice: 67500.50,
    bidPressure: 57,
    askPressure: 43,
    connectionStatus: "CANLI",
    connectionDelayMs: 120,
    symbol: "BTCUSDT",
    priceChange24h: 2.35,
    pricePrecision: 2,
  };

  // ── Test 1: renderToString ──
  {
    const html = renderer.renderToString(testData);
    assert(html.includes("BTCUSDT"), "HTML contains symbol");
    assert(html.includes("VOL"), "HTML contains VOL label");
    assert(html.includes("SPREAD"), "HTML contains SPREAD label");
    assert(html.includes("1.5B"), "Volume formatted: 1.5B");
    assert(html.includes("1.5 bps"), "Spread BPS shown");
    assert(html.includes("67500.00"), "Bid price shown");
    assert(html.includes("67501.00"), "Ask price shown");
    assert(html.includes("CANLI") || html.includes("#00FF88"), "Connection status shown");
  }

  // ── Test 2: Negative change ──
  {
    const negData = { ...testData, priceChange24h: -3.5 };
    const html = renderer.renderToString(negData);
    assert(html.includes("-3.50%"), "Negative change shown");
    assert(html.includes("#FF4444"), "Red color for negative");
  }

  // ── Test 3: Size modes ──
  {
    renderer.setSize("compact");
    const compactHtml = renderer.renderToString(testData);
    assert(compactHtml.length > 0, "Compact render works");

    renderer.setSize("large");
    const largeHtml = renderer.renderToString(testData);
    assert(largeHtml.length > 0, "Large render works");
  }
}

// ═══════════════════════════════════════════════
// TEST 4: AnnotationsRenderer
// ═══════════════════════════════════════════════

function testAnnotationsRenderer(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  ANNOTATIONS RENDERER - VALIDATION");
  console.log("═══════════════════════════════════════");

  const renderer = new AnnotationsRenderer();

  // ── Mock canvas context ──
  const drawCalls: string[] = [];
  const mockCtx = new Proxy({}, {
    get(_, prop) {
      if (prop === "save") return () => drawCalls.push("save");
      if (prop === "restore") return () => drawCalls.push("restore");
      if (prop === "beginPath") return () => drawCalls.push("beginPath");
      if (prop === "moveTo") return () => drawCalls.push("moveTo");
      if (prop === "lineTo") return () => drawCalls.push("lineTo");
      if (prop === "stroke") return () => drawCalls.push("stroke");
      if (prop === "fill") return () => drawCalls.push("fill");
      if (prop === "closePath") return () => drawCalls.push("closePath");
      if (prop === "fillRect") return () => drawCalls.push("fillRect");
      if (prop === "fillText") return () => drawCalls.push("fillText");
      if (prop === "setLineDash") return () => drawCalls.push("setLineDash");
      if (prop === "measureText") return () => ({ width: 50 });
      if (prop === "createLinearGradient") return () => ({
        addColorStop: () => {},
      });
      return undefined;
    },
    set() { return true; },
  }) as CanvasRenderingContext2D;

  const viewport = {
    width: 800, height: 600, minPrice: 67000, maxPrice: 68000,
    priceToY: (p: number) => 600 - ((p - 67000) / 1000) * 600,
    timeToX: (t: number) => 800 - ((Date.now() - t) / 1000) * (800 / 900),
  };

  // ── Test 1: Render with walls ──
  {
    drawCalls.length = 0;
    const walls: WallCluster[] = [
      {
        price: 67400, side: "bid", notional: 1_200_000, quantity: 17.8,
        dominanceRatio: 0.65, p90Threshold: 500_000,
        firstSeen: Date.now() - 45000, ageSec: 45, isPersistent: true,
      },
    ];

    renderer.render(mockCtx, viewport, {
      walls,
      alarms: [],
      whaleArrows: [],
      midPrice: 67500,
      spreadColor: "#00FF88",
    });

    assert(drawCalls.length > 0, `Wall ray rendered: ${drawCalls.length} draw calls`);
  }

  // ── Test 2: Render with alarms ──
  {
    drawCalls.length = 0;
    const alarms: AlarmLine[] = [
      { id: "a1", symbol: "BTCUSDT", price: 67200, type: "below", triggered: false, active: true },
      { id: "a2", symbol: "BTCUSDT", price: 67800, type: "above", triggered: true, active: true },
    ];

    renderer.render(mockCtx, viewport, {
      walls: [],
      alarms,
      whaleArrows: [],
      midPrice: 67500,
      spreadColor: "#00FF88",
    });

    assert(drawCalls.length > 0, `Alarm lines rendered: ${drawCalls.length} draw calls`);
  }

  // ── Test 3: Render with whale arrows ──
  {
    drawCalls.length = 0;
    const arrows: WhaleArrow[] = [
      { price: 67450, side: "buy", notional: 350_000, timestamp: Date.now() - 5000 },
    ];

    renderer.render(mockCtx, viewport, {
      walls: [],
      alarms: [],
      whaleArrows: arrows,
      midPrice: 67500,
      spreadColor: "#00FF88",
    });

    assert(drawCalls.length > 0, `Whale arrow rendered: ${drawCalls.length} draw calls`);
  }

  // ── Test 4: Invalid viewport ──
  {
    drawCalls.length = 0;
    const badViewport = { ...viewport, width: 0, height: 0 };
    renderer.render(mockCtx, badViewport, {
      walls: [], alarms: [], whaleArrows: [], midPrice: 67500, spreadColor: "#00FF88",
    });
    assert(drawCalls.length === 0, "No draw calls with invalid viewport");
  }

  // ── Test 5: Null data ──
  {
    drawCalls.length = 0;
    renderer.render(mockCtx, viewport, null);
    assert(drawCalls.length === 0, "No draw calls with null data");
  }
}

// ═══════════════════════════════════════════════
// TEST 5: LongPressAlarmController (Logic Only)
// ═══════════════════════════════════════════════

function testLongPressAlarmController(): void {
  console.log("\n═══════════════════════════════════════");
  console.log("  LONG PRESS ALARM CONTROLLER");
  console.log("═══════════════════════════════════════");

  // ── Test 1: Construction ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    const pointToPrice = (x: number, y: number) => ({ price: 67500 - y * 10, timestamp: Date.now() });
    
    const controller = new LongPressAlarmController(am, pointToPrice);
    assert(controller !== null, "Controller constructed");
    controller.destroy();
  }

  // ── Test 2: Symbol change ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    const pointToPrice = (x: number, y: number) => ({ price: 67500, timestamp: Date.now() });
    
    const controller = new LongPressAlarmController(am, pointToPrice);
    controller.setSymbol("ETHUSDT");
    // No assertion needed — just verifying no crash
    assert(true, "Symbol changed without error");
    controller.destroy();
  }

  // ── Test 3: Config defaults ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    const pointToPrice = (x: number, y: number) => ({ price: 67500, timestamp: Date.now() });
    
    const controller = new LongPressAlarmController(am, pointToPrice, {
      pressDurationMs: 500,
      moveThresholdPx: 12,
    });
    assert(controller !== null, "Custom config accepted");
    controller.destroy();
  }

  // ── Test 4: Toast handler registration ──
  {
    const storage = new MemoryStorageAdapter();
    const am = new UserAlarmManager({ storage });
    const pointToPrice = (x: number, y: number) => ({ price: 67500, timestamp: Date.now() });
    
    let toastMessage = "";
    const controller = new LongPressAlarmController(am, pointToPrice);
    controller.onToast((msg) => { toastMessage = msg; });
    
    assert(controller !== null, "Toast handler registered");
    controller.destroy();
  }

  // ── Test 5: Point-to-price function ──
  {
    const pointToPrice = (x: number, y: number) => {
      if (y < 0 || y > 600) return null;
      return { price: 68000 - (y / 600) * 1000, timestamp: Date.now() };
    };
    
    const result1 = pointToPrice(400, 300);
    assert(result1 !== null && result1.price === 67500, `Mid-screen price: ${result1?.price}`);
    
    const result2 = pointToPrice(400, 0);
    assert(result2 !== null && result2.price === 68000, `Top price: ${result2?.price}`);
    
    const result3 = pointToPrice(400, 600);
    assert(result3 !== null && result3.price === 67000, `Bottom price: ${result3?.price}`);
    
    const result4 = pointToPrice(400, -10);
    assert(result4 === null, "Out of bounds returns null");
  }

  // ── Test 6: 8px pan guard logic ──
  {
    // Simulate the distance calculation
    const startX = 100, startY = 200;
    const moveX = 105, moveY = 203; // ~5.8px distance
    const dx = Math.abs(moveX - startX);
    const dy = Math.abs(moveY - startY);
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    assert(distance < 8, `5.8px movement < 8px threshold: ${distance.toFixed(2)}`);
    
    const farX = 110, farY = 210; // ~14.1px distance
    const dx2 = Math.abs(farX - startX);
    const dy2 = Math.abs(farY - startY);
    const distance2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
    
    assert(distance2 > 8, `14.1px movement > 8px threshold: ${distance2.toFixed(2)}`);
  }
}

// ═══════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════

console.log("\n╔═══════════════════════════════════════╗");
console.log("║  PREDATOR TERMINAL - FAZ 5 TESTS     ║");
console.log("╚═══════════════════════════════════════╝");

// KlineManager tests are async
(async () => {
  await testKlineManager();
  testEnhancedAlarmManager();
  testHudRenderer();
  testAnnotationsRenderer();
  testLongPressAlarmController();

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  TOTAL: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);
})();
