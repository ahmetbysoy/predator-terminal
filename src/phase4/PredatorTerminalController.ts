/**
 * PREDATOR TERMINAL - FAZ 4: Ana Kontrolör
 * Tüm modülleri birleştiren orchestrator
 */

import { DepthManager } from "../phase0/DepthManager";
import { SpreadAnalyzer } from "../phase0/SpreadAnalyzer";
import { OrderFlowEngine } from "../phase1/OrderFlowEngine";
import { PredatorSignalEngine } from "../phase1/PredatorSignalEngine";
import { RenderEngine } from "../phase2/RenderEngine";
import { LiquidityHeatmap } from "../phase2/LiquidityHeatmap";
import { WallDetector } from "../phase2/WallDetector";
import { StreamMultiplexer } from "./StreamMultiplexer";
import { UserAlarmManager } from "./UserAlarmManager";
import { RenderLayer } from "../shared/types";

export interface PredatorTerminalConfig {
  symbols: string[];
  defaultSymbol: string;
  restBaseUrl: string;
  wsBaseUrl: string;
  enableSignals: boolean;
  enableAlarms: boolean;
  renderFps: number;
}

export interface TerminalStatus {
  isConnected: boolean;
  activeSymbol: string;
  symbols: string[];
  lastUpdate: number;
  connectionAge: number;
  isResyncing: boolean;
  signalCount: number;
  alarmCount: number;
  renderStats: {
    fps: number;
    frameDrops: number;
    heatmapCells: number;
    wallClusters: number;
  };
}

export class PredatorTerminalController {
  private config: PredatorTerminalConfig;
  private depthManager: DepthManager;
  private spreadAnalyzer: SpreadAnalyzer;
  private orderFlowEngine: OrderFlowEngine;
  private signalEngine: PredatorSignalEngine;
  private renderEngine: RenderEngine;
  private heatmap: LiquidityHeatmap;
  private wallDetector: WallDetector;
  private streamMux: StreamMultiplexer;
  private alarmManager: UserAlarmManager;

  private activeSymbol: string;
  private isConnected: boolean = false;
  private isResyncing: boolean = false;
  private connectionStartTime: number = 0;
  private lastUpdateTime: number = 0;
  private signalCount: number = 0;
  private frameCount: number = 0;
  private frameDropCount: number = 0;
  private lastFrameTime: number = 0;
  private renderInterval: number | null = null;

  constructor(config: PredatorTerminalConfig) {
    this.config = config;
    this.activeSymbol = config.defaultSymbol;

    // Initialize all modules
    this.spreadAnalyzer = new SpreadAnalyzer();
    this.depthManager = new DepthManager(this.spreadAnalyzer);
    this.orderFlowEngine = new OrderFlowEngine();
    this.signalEngine = new PredatorSignalEngine(this.orderFlowEngine, this.spreadAnalyzer);
    this.renderEngine = new RenderEngine();
    this.heatmap = new LiquidityHeatmap();
    this.wallDetector = new WallDetector();
    this.streamMux = new StreamMultiplexer(config.wsBaseUrl);
    this.alarmManager = new UserAlarmManager();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Stream events
    this.streamMux.on("connected", () => this.handleConnected());
    this.streamMux.on("disconnected", () => this.handleDisconnected());
    this.streamMux.on("error", (err) => this.handleError(err));
    this.streamMux.on("depth", (data) => this.handleDepthUpdate(data));
    this.streamMux.on("aggTrade", (data) => this.handleAggTrade(data));
    this.streamMux.on("kline", (data) => this.handleKline(data));

    // Depth manager events
    this.depthManager.on("resync", () => {
      this.isResyncing = true;
      this.renderEngine.mark(RenderLayer.HUD);
    });
    this.depthManager.on("synced", () => {
      this.isResyncing = false;
      this.renderEngine.mark(RenderLayer.HUD);
    });

    // Signal events
    this.signalEngine.on("signal", (signal) => {
      this.signalCount++;
      console.log(`[Signal] ${signal.direction} score=${signal.score.toFixed(2)} (${signal.confidence})`);
    });

    // Alarm events
    this.alarmManager.on("triggered", (alarm) => {
      console.log(`[Alarm] ${alarm.symbol} @ ${alarm.price} - ${alarm.type}`);
      this.renderEngine.mark(RenderLayer.HUD);
    });
  }

  public start(): void {
    console.log(`[Terminal] Starting with symbol: ${this.activeSymbol}`);
    this.streamMux.connect(this.activeSymbol);
    this.startRenderLoop();
  }

  public stop(): void {
    console.log("[Terminal] Stopping...");
    this.streamMux.disconnect();
    this.stopRenderLoop();
    this.depthManager.destroy();
    this.orderFlowEngine.reset();
    this.signalEngine.reset();
    this.heatmap.reset();
    this.wallDetector.reset();
  }

  public setSymbol(symbol: string): void {
    if (symbol === this.activeSymbol) return;
    
    console.log(`[Terminal] Switching to ${symbol}`);
    this.activeSymbol = symbol;
    
    // Reset engines
    this.orderFlowEngine.reset();
    this.signalEngine.reset();
    this.heatmap.reset();
    this.wallDetector.reset();
    
    // Reconnect streams
    this.streamMux.switchSymbol(symbol);
  }

  public addAlarm(price: number, type: "above" | "below"): void {
    this.alarmManager.addAlarm(this.activeSymbol, price, type);
    this.renderEngine.mark(RenderLayer.ANNOTATIONS);
  }

  public removeAlarm(alarmId: string): void {
    this.alarmManager.removeAlarm(alarmId);
    this.renderEngine.mark(RenderLayer.ANNOTATIONS);
  }

  public getStatus(): TerminalStatus {
    const now = Date.now();
    const fps = this.frameCount > 0 ? Math.round(this.frameCount / ((now - this.connectionStartTime) / 1000)) : 0;
    const heatStats = this.heatmap.getLastStats();
    
    return {
      isConnected: this.isConnected,
      activeSymbol: this.activeSymbol,
      symbols: this.config.symbols,
      lastUpdate: this.lastUpdateTime,
      connectionAge: this.isConnected ? now - this.connectionStartTime : 0,
      isResyncing: this.isResyncing,
      signalCount: this.signalCount,
      alarmCount: this.alarmManager.getAlarmCount(),
      renderStats: {
        fps,
        frameDrops: this.frameDropCount,
        heatmapCells: heatStats.drawnCells,
        wallClusters: this.wallDetector.getTrackedWallCount(),
      },
    };
  }

  private handleConnected(): void {
    this.isConnected = true;
    this.connectionStartTime = Date.now();
    this.frameCount = 0;
    this.frameDropCount = 0;
    console.log(`[Terminal] Connected to ${this.activeSymbol}`);
    this.renderEngine.mark(RenderLayer.HUD);
  }

  private handleDisconnected(): void {
    this.isConnected = false;
    console.log("[Terminal] Disconnected");
    this.renderEngine.mark(RenderLayer.HUD);
  }

  private handleError(err: Error): void {
    console.error("[Terminal] Error:", err.message);
    this.renderEngine.mark(RenderLayer.HUD);
  }

  private handleDepthUpdate(data: any): void {
    this.lastUpdateTime = Date.now();
    
    // Update depth manager (Binance depth event format)
    if (data.U !== undefined && data.u !== undefined) {
      this.depthManager.processEvent({
        eventType: "depthUpdate",
        eventTime: data.E || Date.now(),
        symbol: data.s || this.activeSymbol,
        firstUpdateId: data.U,
        lastUpdateId: data.u,
        prevLastUpdateId: data.pu || 0,
        bids: (data.b || []).map((b: any) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) })),
        asks: (data.a || []).map((a: any) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) })),
      });
    }
    
    // Get current order book state
    const bidsMap = this.depthManager.getBidsMap(this.activeSymbol);
    const asksMap = this.depthManager.getAsksMap(this.activeSymbol);
    if (!bidsMap || !asksMap) return;

    // Update heatmap
    this.heatmap.sample(bidsMap, asksMap, Date.now(), 1);
    
    // Detect walls (with dynamic BPS for symbol)
    this.wallDetector.setSymbol(this.activeSymbol);
    const walls = this.wallDetector.computeWallClusters(bidsMap, asksMap, Date.now());
    
    // Mark layers for render
    this.renderEngine.mark(RenderLayer.HEATMAP);
    this.renderEngine.mark(RenderLayer.DEPTH_OVERLAY);
    this.renderEngine.mark(RenderLayer.ANNOTATIONS);
    
    // Pass wall data to annotations layer
    this.renderEngine.setData(RenderLayer.ANNOTATIONS, walls);
    
    // Check alarms
    const bestPrices = this.depthManager.getBestPrices(this.activeSymbol);
    if (bestPrices) {
      const midPrice = (bestPrices.bestBid + bestPrices.bestAsk) / 2;
      this.alarmManager.checkPrice(this.activeSymbol, midPrice);
    }
  }

  private handleAggTrade(data: any): void {
    // Update order flow (Binance aggTrade format)
    const price = parseFloat(data.p);
    const qty = parseFloat(data.q);
    const isBuyerMaker = data.m === true;
    const timestamp = data.T || Date.now();

    this.orderFlowEngine.processTrade(this.activeSymbol, price, qty, isBuyerMaker, timestamp);
    
    // Update signal engine
    if (this.config.enableSignals) {
      const bidsMap = this.depthManager.getBidsMap(this.activeSymbol);
      const asksMap = this.depthManager.getAsksMap(this.activeSymbol);
      const bestPrices = this.depthManager.getBestPrices(this.activeSymbol);
      
      if (bidsMap && asksMap && bestPrices) {
        const now = Date.now();
        this.signalEngine.evaluate(
          this.activeSymbol,
          bidsMap,
          asksMap,
          bestPrices.bestBid,
          bestPrices.bestAsk,
          "1m",
          60,
          now - 60000
        );
      }
    }
    
    this.renderEngine.mark(RenderLayer.HUD);
  }

  private handleKline(data: any): void {
    // Kline data for future candle rendering
    this.lastUpdateTime = Date.now();
  }

  private startRenderLoop(): void {
    // The RenderEngine uses its own rAF loop internally.
    // We just track frame stats here for the developer HUD.
    const interval = 1000 / this.config.renderFps;
    
    this.renderInterval = setInterval(() => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      
      // Frame drop detection
      if (this.lastFrameTime > 0 && delta > interval * 1.5) {
        this.frameDropCount++;
      }
      
      this.lastFrameTime = now;
      this.frameCount++;
    }, interval);
  }

  private stopRenderLoop(): void {
    if (this.renderInterval !== null) {
      clearInterval(this.renderInterval);
      this.renderInterval = null;
    }
  }
}
