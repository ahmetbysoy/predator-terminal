/**
 * PREDATOR TERMINAL - FAZ 5: AnnotationsRenderer
 * ==================================================
 * Duvar ray'ları + etiketleri + alarm çizgileri + whale okları.
 *
 * Denetçi Sorusu #5: "AnnotationsRenderer nerede?"
 * Cevap: Canvas üzerine duvar ray'ları, alarm çizgileri ve whale okları çizer.
 */

import { Viewport, WallCluster } from "../shared/types";

export interface AlarmLine {
  id: string;
  symbol: string;
  price: number;
  type: "above" | "below";
  triggered: boolean;
  active: boolean;
}

export interface WhaleArrow {
  price: number;
  side: "buy" | "sell";
  notional: number;
  timestamp: number;
}

export interface AnnotationsData {
  walls: WallCluster[];
  alarms: AlarmLine[];
  whaleArrows: WhaleArrow[];
  midPrice: number;
  spreadColor: string;
}

export class AnnotationsRenderer {
  private labelZones: Array<{ x: number; y: number; w: number; h: number }> = [];

  /**
   * RenderEngine.registerRenderer() için render fonksiyonu.
   */
  public render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    data: unknown
  ): void {
    if (!data) return;
    const ann = data as AnnotationsData;

    if (viewport.width <= 0 || viewport.height <= 0 ||
        viewport.minPrice >= viewport.maxPrice) return;

    // ── Clear label zones for this frame ──
    this.labelZones = [];

    // ── 1. MID çizgisi (kesikli) ──
    if (ann.midPrice > 0) {
      this.drawMidLine(ctx, viewport, ann.midPrice);
    }

    // ── 2. Alarm çizgileri ──
    for (const alarm of ann.alarms) {
      this.drawAlarmLine(ctx, viewport, alarm);
    }

    // ── 3. Duvar ray'ları + etiketleri ──
    for (const wall of ann.walls) {
      this.drawWallRay(ctx, viewport, wall);
    }

    // ── 4. Whale ok işaretleri ──
    for (const arrow of ann.whaleArrows) {
      this.drawWhaleArrow(ctx, viewport, arrow);
    }
  }

  // ─────────────────────────────────────────────
  // PRIVATE: MID LINE
  // ─────────────────────────────────────────────

  private drawMidLine(ctx: CanvasRenderingContext2D, viewport: Viewport, midPrice: number): void {
    if (midPrice < viewport.minPrice || midPrice > viewport.maxPrice) return;

    const y = viewport.priceToY(midPrice);
    if (!Number.isFinite(y)) return;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#AAAAAA44";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ─────────────────────────────────────────────
  // PRIVATE: ALARM LINES
  // ─────────────────────────────────────────────

  private drawAlarmLine(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    alarm: AlarmLine
  ): void {
    if (alarm.price < viewport.minPrice || alarm.price > viewport.maxPrice) return;

    const y = viewport.priceToY(alarm.price);
    if (!Number.isFinite(y)) return;

    ctx.save();

    // ── Çizgi ──
    ctx.setLineDash(alarm.triggered ? [2, 6] : [6, 3]);
    ctx.strokeStyle = alarm.triggered ? "#88888866" : alarm.active ? "#FFD700AA" : "#88888844";
    ctx.lineWidth = alarm.triggered ? 1 : 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewport.width, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Etiket ──
    const label = `${alarm.type === "above" ? "▲" : "▼"} ${alarm.price.toFixed(2)}`;
    ctx.font = "10px monospace";
    ctx.fillStyle = alarm.triggered ? "#888888" : "#FFD700";
    const tw = ctx.measureText(label).width;

    // ── Çakışma kontrolü ──
    const labelRect = { x: viewport.width - tw - 8, y: y - 7, w: tw + 8, h: 14 };
    if (!this.overlapsAnyZone(labelRect)) {
      ctx.fillStyle += "33"; // Background
      ctx.fillRect(labelRect.x, labelRect.y, labelRect.w, labelRect.h);
      ctx.fillStyle = alarm.triggered ? "#888888" : "#FFD700";
      ctx.fillText(label, labelRect.x + 4, y + 3);
      this.labelZones.push(labelRect);
    }

    ctx.restore();
  }

  // ─────────────────────────────────────────────
  // PRIVATE: WALL RAYS
  // ─────────────────────────────────────────────

  private drawWallRay(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    wall: WallCluster
  ): void {
    if (wall.price < viewport.minPrice || wall.price > viewport.maxPrice) return;

    const y = viewport.priceToY(wall.price);
    if (!Number.isFinite(y)) return;

    ctx.save();

    // ── Gradient ray (sağa doğru soluklaşan) ──
    const rayLength = Math.min(viewport.width * 0.4, 200);
    const gradient = ctx.createLinearGradient(viewport.width - rayLength, y, viewport.width, y);

    const baseColor = wall.side === "bid" ? "0,200,100" : "255,68,68";
    gradient.addColorStop(0, `rgba(${baseColor},0)`);
    gradient.addColorStop(0.5, `rgba(${baseColor},0.15)`);
    gradient.addColorStop(1, `rgba(${baseColor},0.4)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(viewport.width - rayLength, y - 2, rayLength, 4);

    // ── Etiket ──
    const notional = wall.notional;
    const notionalStr = notional >= 1_000_000
      ? `$${(notional / 1_000_000).toFixed(1)}M`
      : `$${(notional / 1_000).toFixed(0)}K`;

    // ── Yaş bilgisi + persistent marker ──
    const ageStr = wall.ageSec >= 60
      ? `${Math.floor(wall.ageSec / 60)}m${Math.round(wall.ageSec % 60)}s`
      : `${Math.round(wall.ageSec)}s`;

    const persistentMark = wall.isPersistent ? " ©" : "";
    const label = `${notionalStr} · ${ageStr}${persistentMark}`;

    ctx.font = "bold 10px monospace";
    ctx.fillStyle = wall.side === "bid" ? "#00CC66" : "#FF4444";
    const tw = ctx.measureText(label).width;

    // ── Etiket çakışma önleme ──
    const labelRect = { x: viewport.width - tw - 12, y: y - 8, w: tw + 8, h: 16 };

    if (tw + 8 <= rayLength && !this.overlapsAnyZone(labelRect)) {
      // ── Background ──
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(labelRect.x, labelRect.y, labelRect.w, labelRect.h);

      // ── Text ──
      ctx.fillStyle = wall.side === "bid" ? "#00CC66" : "#FF4444";
      ctx.fillText(label, labelRect.x + 4, y + 3);
      this.labelZones.push(labelRect);
    }
    // Yer yoksa etiket çizilmez — asla taşma yok

    ctx.restore();
  }

  // ─────────────────────────────────────────────
  // PRIVATE: WHALE ARROWS
  // ─────────────────────────────────────────────

  private drawWhaleArrow(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    arrow: WhaleArrow
  ): void {
    if (arrow.price < viewport.minPrice || arrow.price > viewport.maxPrice) return;

    const y = viewport.priceToY(arrow.price);
    const x = viewport.timeToX(arrow.timestamp);
    if (!Number.isFinite(y) || !Number.isFinite(x)) return;
    if (x < 0 || x > viewport.width) return;

    ctx.save();

    const size = 6;
    const isBuy = arrow.side === "buy";
    const dir = isBuy ? 1 : -1;

    ctx.fillStyle = isBuy ? "#00FF88" : "#FF4444";
    ctx.beginPath();
    ctx.moveTo(x, y + dir * size * 2);
    ctx.lineTo(x - size, y + dir * size * 3);
    ctx.lineTo(x + size, y + dir * size * 3);
    ctx.closePath();
    ctx.fill();

    // ── Notional label ──
    const notionalStr = arrow.notional >= 1_000_000
      ? `$${(arrow.notional / 1_000_000).toFixed(1)}M`
      : `$${(arrow.notional / 1_000).toFixed(0)}K`;

    ctx.font = "9px monospace";
    ctx.fillStyle = isBuy ? "#00FF88" : "#FF4444";
    ctx.fillText(notionalStr, x + size + 2, y + dir * size * 2.5);

    ctx.restore();
  }

  // ─────────────────────────────────────────────
  // PRIVATE: LABEL COLLISION
  // ─────────────────────────────────────────────

  private overlapsAnyZone(rect: { x: number; y: number; w: number; h: number }): boolean {
    for (const zone of this.labelZones) {
      if (rect.x < zone.x + zone.w &&
          rect.x + rect.w > zone.x &&
          rect.y < zone.y + zone.h &&
          rect.y + rect.h > zone.y) {
        return true;
      }
    }
    return false;
  }
}
