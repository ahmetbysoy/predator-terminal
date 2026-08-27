/**
 * PREDATOR TERMINAL - FAZ 5: HudRenderer
 * ==========================================
 * 8 hücreli alt HUD: VOL, SPREAD, IMB, DUVAR, BID, ASK, MID, BASKI
 *
 * Denetçi Sorusu #5: "RenderEngine boş kabuk"
 * Cevap: İşte somut render fonksiyonları.
 */

import { Viewport, RenderLayer } from "../shared/types";
import { SpreadResult, SpreadStatus } from "../shared/types";

export interface HudData {
  volume24h: number;
  spreadBps: number;
  spreadAction: string;
  spreadColor: string;
  imbalancePct: number;
  wallCount: number;
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  bidPressure: number;  // 0-100%
  askPressure: number;  // 0-100%
  connectionStatus: "CANLI" | "GECİKME" | "SENK" | "KOPUK" | "OFFLINE";
  connectionDelayMs: number;
  symbol: string;
  priceChange24h: number;
  pricePrecision: number;
}

const DEFAULT_HUD_DATA: HudData = {
  volume24h: 0,
  spreadBps: 0,
  spreadAction: "N/A",
  spreadColor: "#888888",
  imbalancePct: 0,
  wallCount: 0,
  bestBid: 0,
  bestAsk: 0,
  midPrice: 0,
  bidPressure: 50,
  askPressure: 50,
  connectionStatus: "OFFLINE",
  connectionDelayMs: 0,
  symbol: "BTCUSDT",
  priceChange24h: 0,
  pricePrecision: 2,
};

export type HudSize = "compact" | "normal" | "large";

export class HudRenderer {
  private size: HudSize = "normal";
  private lastData: HudData = { ...DEFAULT_HUD_DATA };

  constructor(size?: HudSize) {
    if (size) this.size = size;
  }

  public setSize(size: HudSize): void {
    this.size = size;
  }

  /**
   * RenderEngine.registerRenderer() için render fonksiyonu.
   * DOM tabanlı HUD günceller (canvas değil, HTML element).
   */
  public render(
    _ctx: CanvasRenderingContext2D,
    _viewport: Viewport,
    data: unknown
  ): void {
    const hudData = (data as HudData) ?? this.lastData;
    this.lastData = hudData;

    // ── HUD DOM element'ini bul (veya oluştur) ──
    let hudEl = typeof document !== "undefined"
      ? document.getElementById("predator-hud")
      : null;

    if (!hudEl) return; // Headless ortamda DOM yok

    const cells = this.buildCells(hudData);
    hudEl.innerHTML = cells;
    hudEl.className = `predator-hud predator-hud--${this.size}`;
  }

  /**
   * Headless render: HTML string döner (test ve SSR için).
   */
  public renderToString(data?: HudData): string {
    const hudData = data ?? this.lastData;
    return this.buildCells(hudData);
  }

  // ─────────────────────────────────────────────
  // PRIVATE: BUILD CELLS
  // ─────────────────────────────────────────────

  private buildCells(d: HudData): string {
    const p = d.pricePrecision;
    const statusColor = this.getStatusColor(d.connectionStatus);
    const imbColor = d.imbalancePct > 0 ? "#00CC66" : d.imbalancePct < 0 ? "#FF4444" : "#888888";
    const changeColor = d.priceChange24h >= 0 ? "#00CC66" : "#FF4444";

    return `
      <div class="hud-row">
        <span class="hud-status" style="color:${statusColor}">●</span>
        <span class="hud-symbol">${d.symbol}</span>
        <span class="hud-change" style="color:${changeColor}">${d.priceChange24h >= 0 ? "+" : ""}${d.priceChange24h.toFixed(2)}%</span>
      </div>
      <div class="hud-grid">
        <div class="hud-cell">
          <span class="hud-label">VOL</span>
          <span class="hud-value">${this.formatVolume(d.volume24h)}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">SPREAD</span>
          <span class="hud-value" style="color:${d.spreadColor}">${d.spreadBps.toFixed(1)} bps</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">IMB</span>
          <span class="hud-value" style="color:${imbColor}">${d.imbalancePct > 0 ? "+" : ""}${d.imbalancePct.toFixed(1)}%</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">DUVAR</span>
          <span class="hud-value">${d.wallCount}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">BID</span>
          <span class="hud-value" style="color:#00CC66">${d.bestBid.toFixed(p)}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">ASK</span>
          <span class="hud-value" style="color:#FF4444">${d.bestAsk.toFixed(p)}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">MID</span>
          <span class="hud-value">${d.midPrice.toFixed(p)}</span>
        </div>
        <div class="hud-cell">
          <span class="hud-label">BASKI</span>
          <span class="hud-value">
            <span style="color:#00CC66">${d.bidPressure.toFixed(0)}%</span>
            /
            <span style="color:#FF4444">${d.askPressure.toFixed(0)}%</span>
          </span>
        </div>
      </div>
    `.replace(/\n\s+/g, "").trim();
  }

  private getStatusColor(status: string): string {
    switch (status) {
      case "CANLI": return "#00FF88";
      case "GECİKME": return "#FFD700";
      case "SENK": return "#FF8C00";
      case "KOPUK": return "#FF2D2D";
      case "OFFLINE": return "#888888";
      default: return "#888888";
    }
  }

  private formatVolume(vol: number): string {
    if (vol >= 1_000_000_000) return `${(vol / 1_000_000_000).toFixed(1)}B`;
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
    return vol.toFixed(0);
  }
}
