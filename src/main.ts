/**
 * PREDATOR TERMINAL - FAZ 6: Main Entry Point
 * ================================================
 * DOMContentLoaded'da tüm sistemi ateşler.
 * Lightweight Charts + tüm modüller + event wiring.
 *
 * Denetçi Sorusu #1: "main.ts nerede?"
 * Cevap: İşte burada. Parmağı tetiğe indiren dosya.
 */

import { SpreadAnalyzer } from "./phase0/SpreadAnalyzer";
import { DepthManager } from "./phase0/DepthManager";
import { OrderFlowEngine } from "./phase1/OrderFlowEngine";
import { PredatorSignalEngine } from "./phase1/PredatorSignalEngine";
import { RenderEngine } from "./phase2/RenderEngine";
import { LiquidityHeatmap } from "./phase2/LiquidityHeatmap";
import { WallDetector } from "./phase2/WallDetector";
import { StreamMultiplexer } from "./phase4/StreamMultiplexer";
import { PredatorTerminalController } from "./phase4/PredatorTerminalController";
import { KlineManager } from "./phase5/KlineManager";
import { UserAlarmManager, MemoryStorageAdapter } from "./phase5/UserAlarmManager";
import { HudRenderer, HudData } from "./phase5/HudRenderer";
import { AnnotationsRenderer, AlarmLine, WhaleArrow } from "./phase5/AnnotationsRenderer";
import { LongPressAlarmController } from "./phase5/LongPressAlarmController";
import { RenderLayer, WallCluster } from "./shared/types";

// ─────────────────────────────────────────────
// LIGHTWEIGHT CHARTS TYPE DECLARATIONS
// ─────────────────────────────────────────────

declare const LightweightCharts: {
  createChart(container: HTMLElement, options: any): any;
};

// ─────────────────────────────────────────────
// PREDATOR TERMINAL - MAIN
// ─────────────────────────────────────────────

class PredatorTerminal {
  // ── Modules ──
  private spreadAnalyzer!: SpreadAnalyzer;
  private depthManager!: DepthManager;
  private orderFlow!: OrderFlowEngine;
  private signalEngine!: PredatorSignalEngine;
  private renderEngine!: RenderEngine;
  private heatmap!: LiquidityHeatmap;
  private wallDetector!: WallDetector;
  private streamMux!: StreamMultiplexer;
  private klineManager!: KlineManager;
  private alarmManager!: UserAlarmManager;
  private hudRenderer!: HudRenderer;
  private annotationsRenderer!: AnnotationsRenderer;
  private longPressController!: LongPressAlarmController;

  // ── Chart ──
  private chart: any = null;
  private candleSeries: any = null;
  private volumeSeries: any = null;

  // ── State ──
  private currentSymbol: string = "BTCUSDT";
  private currentInterval: string = "1m";
  private whaleArrows: WhaleArrow[] = [];

  constructor() {
    // ── Wait for DOM ──
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }
  }

  // ─────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────

  private async init(): Promise<void> {
    console.log("[Predator] Initializing...");

    this.initModules();
    this.initChart();
    this.initRenderers();
    this.initEventWiring();
    this.initSymbolSelector();
    this.initToast();

    // ── Load initial data ──
    await this.loadSymbol(this.currentSymbol);

    console.log("[Predator] Ready. 🔥");
  }

  private initModules(): void {
    // ── Phase 0: Data Layer ──
    this.spreadAnalyzer = new SpreadAnalyzer(undefined, 200);
    this.depthManager = new DepthManager(this.spreadAnalyzer);

    // ── Phase 1: Muscles ──
    this.orderFlow = new OrderFlowEngine();
    this.signalEngine = new PredatorSignalEngine(this.orderFlow, this.spreadAnalyzer);

    // ── Phase 2: Eyes ──
    this.renderEngine = new RenderEngine();
    this.heatmap = new LiquidityHeatmap();
    this.wallDetector = new WallDetector();

    // ── Phase 4: Brain ──
    this.streamMux = new StreamMultiplexer("wss://stream.binance.com:9443/ws");

    // ── Phase 5: UI ──
    this.klineManager = new KlineManager();
    this.alarmManager = new UserAlarmManager();
    this.hudRenderer = new HudRenderer("normal");
    this.annotationsRenderer = new AnnotationsRenderer();
    this.longPressController = new LongPressAlarmController(
      this.alarmManager,
      (x: number, y: number) => this.pointToPrice(x, y)
    );
  }

  private initChart(): void {
    const container = document.getElementById("chart-container");
    if (!container) {
      console.error("[Predator] Chart container not found");
      return;
    }

    // ── Lightweight Charts ──
    if (typeof LightweightCharts === "undefined") {
      console.error("[Predator] LightweightCharts not loaded");
      return;
    }

    this.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { color: "#0a0a0f" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#1a1a2e" },
        horzLines: { color: "#1a1a2e" },
      },
      crosshair: {
        mode: 1, // Normal crosshair
      },
      rightPriceScale: {
        borderColor: "#2a2a3e",
      },
      timeScale: {
        borderColor: "#2a2a3e",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    // ── Candlestick series ──
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor: "#00CC66",
      downColor: "#FF4444",
      borderUpColor: "#00CC66",
      borderDownColor: "#FF4444",
      wickUpColor: "#00CC6688",
      wickDownColor: "#FF444488",
    });

    // ── Volume series ──
    this.volumeSeries = this.chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    this.chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    // ── Canvas overlay for heatmap + annotations ──
    const chartWidget = container.querySelector("canvas");
    if (chartWidget) {
      this.initCanvasOverlay(container);
    }

    // ── Resize handler ──
    const resizeObserver = new ResizeObserver(() => {
      this.chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
      this.renderEngine.markAll();
    });
    resizeObserver.observe(container);
  }

  private initCanvasOverlay(container: HTMLElement): void {
    // ── Create overlay canvases ──
    const heatmapCanvas = document.createElement("canvas");
    heatmapCanvas.id = "heatmap-canvas";
    heatmapCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:8;pointer-events:none;";

    const annotCanvas = document.createElement("canvas");
    annotCanvas.id = "annotations-canvas";
    annotCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:auto;";

    container.style.position = "relative";
    container.appendChild(heatmapCanvas);
    container.appendChild(annotCanvas);

    // ── Size canvases ──
    const resizeCanvases = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [heatmapCanvas, annotCanvas]) {
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.scale(dpr, dpr);
      }
    };
    resizeCanvases();
    new ResizeObserver(resizeCanvases).observe(container);
  }

  private initRenderers(): void {
    // ── HUD (DOM-based, not canvas) ──
    const hudEl = document.getElementById("predator-hud");
    if (hudEl) {
      const hudCtx = document.createElement("canvas").getContext("2d");
      if (hudCtx) {
        this.renderEngine.registerRenderer(RenderLayer.HUD, hudCtx, (ctx, vp, data) => {
          this.hudRenderer.render(ctx, vp, data);
        });
      }
    }

    // ── Heatmap (canvas) ──
    const heatmapCanvas = document.getElementById("heatmap-canvas") as HTMLCanvasElement;
    if (heatmapCanvas) {
      const heatCtx = heatmapCanvas.getContext("2d");
      if (heatCtx) {
        this.renderEngine.registerRenderer(RenderLayer.HEATMAP, heatCtx, (ctx, vp) => {
          this.heatmap.render(ctx, vp);
        });
      }
    }

    // ── Depth overlay (placeholder — DOM ladder goes here) ──
    const depthCtx = document.createElement("canvas").getContext("2d");
    if (depthCtx) {
      this.renderEngine.registerRenderer(RenderLayer.DEPTH_OVERLAY, depthCtx, () => {
        // DOM ladder rendered separately via HTML
      });
    }

    // ── Annotations (canvas) ──
    const annotCanvas = document.getElementById("annotations-canvas") as HTMLCanvasElement;
    if (annotCanvas) {
      const annotCtx = annotCanvas.getContext("2d");
      if (annotCtx) {
        this.renderEngine.registerRenderer(RenderLayer.ANNOTATIONS, annotCtx, (ctx, vp, data) => {
          this.annotationsRenderer.render(ctx, vp, data);
        });
      }
    }
  }

  // ─────────────────────────────────────────────
  // EVENT WIRING
  // ─────────────────────────────────────────────

  private initEventWiring(): void {
    // ── Stream: depth → DepthManager → Heatmap → Walls → Render ──
    this.streamMux.on("depth", (data: any) => {
      if (!data || data.U === undefined) return;

      this.depthManager.processEvent({
        eventType: "depthUpdate",
        eventTime: data.E || Date.now(),
        symbol: data.s || this.currentSymbol,
        firstUpdateId: data.U,
        lastUpdateId: data.u,
        prevLastUpdateId: data.pu || 0,
        bids: (data.b || []).map((b: any) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) })),
        asks: (data.a || []).map((a: any) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) })),
      });

      // ── Update heatmap ──
      const bids = this.depthManager.getBidsMap(this.currentSymbol);
      const asks = this.depthManager.getAsksMap(this.currentSymbol);
      if (bids && asks) {
        const priceBinSize = this.getPriceBinSize();
        this.heatmap.sample(bids, asks, Date.now(), priceBinSize);

        // ── Detect walls ──
        this.wallDetector.setSymbol(this.currentSymbol);
        const walls = this.wallDetector.computeWallClusters(bids, asks, Date.now());

        // ── Update annotations data ──
        this.updateAnnotationsData(walls);
        this.renderEngine.mark(RenderLayer.HEATMAP);
        this.renderEngine.mark(RenderLayer.ANNOTATIONS);
      }

      this.renderEngine.mark(RenderLayer.HUD);
      this.updateHudData();
    });

    // ── Stream: aggTrade → OrderFlow → Signal → Render ──
    this.streamMux.on("aggTrade", (data: any) => {
      const price = parseFloat(data.p);
      const qty = parseFloat(data.q);
      const isBuyerMaker = data.m === true;
      const timestamp = data.T || Date.now();

      const trade = this.orderFlow.processTrade(this.currentSymbol, price, qty, isBuyerMaker, timestamp);

      // ── Whale arrow tracking ──
      if (trade.isWhale) {
        this.whaleArrows.push({
          price: trade.price,
          side: trade.side,
          notional: trade.notional,
          timestamp: trade.timestamp,
        });
        // Keep last 50 arrows
        if (this.whaleArrows.length > 50) this.whaleArrows.shift();
        this.renderEngine.mark(RenderLayer.ANNOTATIONS);
      }

      // ── Signal evaluation on each trade ──
      const bids = this.depthManager.getBidsMap(this.currentSymbol);
      const asks = this.depthManager.getAsksMap(this.currentSymbol);
      const bestPrices = this.depthManager.getBestPrices(this.currentSymbol);
      if (bids && asks && bestPrices) {
        this.signalEngine.evaluate(
          this.currentSymbol, bids, asks,
          bestPrices.bestBid, bestPrices.bestAsk,
          this.currentInterval,
          this.klineManager.getIntervalSeconds(),
          this.klineManager.getCurrentCandle()?.time ?? Date.now()
        );
      }

      this.renderEngine.mark(RenderLayer.HUD);
      this.updateHudData();
    });

    // ── Stream: kline → KlineManager → Chart update ──
    this.streamMux.on("kline", (data: any) => {
      const candle = this.klineManager.processKline(data);
      if (candle && this.candleSeries) {
        this.candleSeries.update({
          time: Math.floor(candle.time / 1000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        });

        this.volumeSeries.update({
          time: Math.floor(candle.time / 1000),
          value: candle.volume,
          color: candle.close >= candle.open ? "#00CC6633" : "#FF444433",
        });
      }
    });

    // ── Stream: ticker → UserAlarmManager.checkAll() ──
    this.streamMux.on("ticker", (data: any) => {
      if (Array.isArray(data)) {
        this.alarmManager.checkAll(data);
      }
    });

    // ── Signal events → Signal panel ──
    this.signalEngine.on("signal", (signal) => {
      this.appendSignalCard(signal);
      this.renderEngine.mark(RenderLayer.ANNOTATIONS);
    });

    // ── Alarm events → Toast ──
    this.alarmManager.on("toast", (event: { message: string }) => {
      this.showToast(event.message);
    });

    // ── Depth resync → Connection badge ──
    this.depthManager.on("resync", () => {
      this.updateConnectionBadge("SENK", 0);
    });
    this.depthManager.on("synced", () => {
      this.updateConnectionBadge("CANLI", 0);
    });
    this.depthManager.on("disconnected", () => {
      this.updateConnectionBadge("KOPUK", 0);
    });
    this.streamMux.on("disconnected", () => {
      this.updateConnectionBadge("KOPUK", 0);
    });
    this.streamMux.on("connected", () => {
      this.updateConnectionBadge("CANLI", 0);
    });

    // ── LongPress → Alarm creation ──
    const annotCanvas = document.getElementById("annotations-canvas") as HTMLElement;
    if (annotCanvas) {
      this.longPressController.bind(annotCanvas as HTMLElement, this.currentSymbol);
      this.longPressController.onToast((msg) => this.showToast(msg));
    }
  }

  // ─────────────────────────────────────────────
  // SYMBOL LOADING
  // ─────────────────────────────────────────────

  private async loadSymbol(symbol: string): Promise<void> {
    console.log(`[Predator] Loading ${symbol}...`);
    this.currentSymbol = symbol;

    // ── Reset all engines ──
    this.orderFlow.reset();
    this.signalEngine.reset();
    this.heatmap.reset();
    this.wallDetector.reset();
    this.klineManager.reset();
    this.whaleArrows = [];

    // ── Load candle history ──
    try {
      const candles = await this.klineManager.loadHistory(symbol, this.currentInterval, 500);
      if (candles.length > 0 && this.candleSeries) {
        const chartData = candles.map((c) => ({
          time: Math.floor(c.time / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }));
        this.candleSeries.setData(chartData);

        const volData = candles.map((c) => ({
          time: Math.floor(c.time / 1000),
          value: c.volume,
          color: c.close >= c.open ? "#00CC6633" : "#FF444433",
        }));
        this.volumeSeries.setData(volData);

        this.chart.timeScale().fitContent();
      }
    } catch (err) {
      console.error(`[Predator] Failed to load klines for ${symbol}:`, err);
    }

    // ── Initialize heatmap grid ──
    const bestPrices = this.depthManager.getBestPrices(symbol);
    if (bestPrices) {
      const range = bestPrices.bestAsk * 0.01; // ±1% range
      this.heatmap.reinitGrid(
        this.getPriceBinSize(),
        bestPrices.bestBid - range,
        bestPrices.bestAsk + range,
        Date.now()
      );
    }

    // ── Start depth subscription ──
    await this.depthManager.subscribe(symbol);

    // ── Connect streams ──
    this.streamMux.connect(symbol);

    // ── Start render loop ──
    const viewport = this.getViewport();
    if (viewport) {
      this.renderEngine.start(viewport);
    }

    // ── Update long press symbol ──
    this.longPressController.setSymbol(symbol);

    // ── Update title ──
    const titleEl = document.getElementById("symbol-title");
    if (titleEl) titleEl.textContent = symbol;

    console.log(`[Predator] ${symbol} loaded.`);
  }

  // ─────────────────────────────────────────────
  // UI HELPERS
  // ─────────────────────────────────────────────

  private initSymbolSelector(): void {
    const selector = document.getElementById("symbol-selector") as HTMLSelectElement;
    if (!selector) return;

    const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "SHIBUSDT", "PEPEUSDT"];
    selector.innerHTML = symbols.map((s) =>
      `<option value="${s}" ${s === this.currentSymbol ? "selected" : ""}>${s}</option>`
    ).join("");

    selector.addEventListener("change", () => {
      const newSymbol = selector.value;
      if (newSymbol !== this.currentSymbol) {
        this.loadSymbol(newSymbol);
      }
    });
  }

  private initToast(): void {
    // ── Toast container ──
    if (!document.getElementById("toast-container")) {
      const toast = document.createElement("div");
      toast.id = "toast-container";
      toast.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;";
      document.body.appendChild(toast);
    }
  }

  private showToast(message: string): void {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const el = document.createElement("div");
    el.style.cssText = `
      background:#1a1a2e;color:#d1d4dc;padding:12px 20px;border-radius:8px;
      font-size:14px;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5);
      border-left:3px solid #FFD700;animation:fadeIn 0.3s ease;
    `;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  private updateHudData(): void {
    const spread = this.spreadAnalyzer.getLastResult(this.currentSymbol);
    const bestPrices = this.depthManager.getBestPrices(this.currentSymbol);
    const bids = this.depthManager.getBidsMap(this.currentSymbol);
    const asks = this.depthManager.getAsksMap(this.currentSymbol);

    let imbalancePct = 0;
    let bidPressure = 50;
    if (bids && asks) {
      let bidTotal = 0, askTotal = 0;
      for (const [, qty] of bids) bidTotal += qty;
      for (const [, qty] of asks) askTotal += qty;
      const total = bidTotal + askTotal;
      if (total > 0) {
        imbalancePct = ((bidTotal - askTotal) / total) * 100;
        bidPressure = (bidTotal / total) * 100;
      }
    }

    const hudData: HudData = {
      volume24h: 0, // Would come from 24hr ticker
      spreadBps: spread?.bps ?? 0,
      spreadAction: spread?.action ?? "N/A",
      spreadColor: spread?.uiColorHex ?? "#888888",
      imbalancePct,
      wallCount: this.wallDetector.getTrackedWallCount(),
      bestBid: bestPrices?.bestBid ?? 0,
      bestAsk: bestPrices?.bestAsk ?? 0,
      midPrice: bestPrices ? (bestPrices.bestBid + bestPrices.bestAsk) / 2 : 0,
      bidPressure,
      askPressure: 100 - bidPressure,
      connectionStatus: this.depthManager.isSynced(this.currentSymbol) ? "CANLI" : "SENK",
      connectionDelayMs: 0,
      symbol: this.currentSymbol,
      priceChange24h: 0,
      pricePrecision: this.getPricePrecision(),
    };

    this.renderEngine.setData(RenderLayer.HUD, hudData);
    this.renderEngine.mark(RenderLayer.HUD);
  }

  private updateAnnotationsData(walls: WallCluster[]): void {
    const alarmLines: AlarmLine[] = this.alarmManager.getAlarms(this.currentSymbol).map((a) => ({
      id: a.id,
      symbol: a.symbol,
      price: a.price,
      type: a.type,
      triggered: a.triggered,
      active: a.active,
    }));

    const bestPrices = this.depthManager.getBestPrices(this.currentSymbol);
    const midPrice = bestPrices ? (bestPrices.bestBid + bestPrices.bestAsk) / 2 : 0;

    this.renderEngine.setData(RenderLayer.ANNOTATIONS, {
      walls,
      alarms: alarmLines,
      whaleArrows: this.whaleArrows,
      midPrice,
      spreadColor: this.spreadAnalyzer.getLastResult(this.currentSymbol)?.uiColorHex ?? "#888888",
    });
  }

  private updateConnectionBadge(status: string, delayMs: number): void {
    const badge = document.getElementById("connection-badge");
    if (!badge) return;
    badge.textContent = status;
    badge.style.color = status === "CANLI" ? "#00FF88" : status === "SENK" ? "#FF8C00" : "#FF2D2D";
  }

  private appendSignalCard(signal: any): void {
    const panel = document.getElementById("signal-panel");
    if (!panel) return;

    const card = document.createElement("div");
    card.className = `signal-card signal-${signal.direction.toLowerCase()}`;
    card.innerHTML = `
      <div class="signal-dir">${signal.direction}</div>
      <div class="signal-score">${signal.score.toFixed(2)}</div>
      <div class="signal-conf">${signal.confidence}</div>
      <div class="signal-time">${new Date(signal.timestamp).toLocaleTimeString()}</div>
    `;
    panel.prepend(card);

    // Keep max 50 cards
    while (panel.children.length > 50) {
      panel.removeChild(panel.lastChild!);
    }
  }

  // ─────────────────────────────────────────────
  // VIEWPORT & UTILITIES
  // ─────────────────────────────────────────────

  private getViewport() {
    if (!this.chart || !this.candleSeries) return null;

    const container = document.getElementById("chart-container");
    if (!container) return null;

    const priceScale = this.candleSeries.priceScale();
    const timeScale = this.chart.timeScale();

    return {
      width: container.clientWidth,
      height: container.clientHeight,
      minPrice: 0,
      maxPrice: 100000,
      priceToY: (price: number) => {
        const coord = this.candleSeries.priceToCoordinate(price);
        return typeof coord === "number" ? coord : NaN;
      },
      timeToX: (time: number) => {
        const coord = timeScale.timeToCoordinate(Math.floor(time / 1000) as any);
        return typeof coord === "number" ? coord : NaN;
      },
    };
  }

  private pointToPrice(x: number, y: number): { price: number; timestamp: number } | null {
    if (!this.candleSeries) return null;
    const price = this.candleSeries.coordinateToPrice(y);
    if (typeof price !== "number" || !Number.isFinite(price)) return null;
    return { price, timestamp: Date.now() };
  }

  private getPriceBinSize(): number {
    const precision = this.getPricePrecision();
    const base = this.depthManager.getBestPrices(this.currentSymbol)?.bestBid ?? 67500;
    return base * 0.0001; // 1 BPS of current price
  }

  private getPricePrecision(): number {
    if (this.currentSymbol.includes("SHIB") || this.currentSymbol.includes("PEPE")) return 6;
    if (this.currentSymbol.includes("DOGE")) return 5;
    if (this.currentSymbol.includes("BTC")) return 1;
    return 2;
  }
}

// ─────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────

new PredatorTerminal();
