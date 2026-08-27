/**
 * PREDATOR TERMINAL - FAZ 2: LiquidityHeatmap
 * ================================================
 * Zaman × Fiyat ısı haritası.
 *
 * - Viewport culling: görünmeyen fiyat = fillRect YASAK
 * - 256 renkli Plasma LUT (string birleştirme YASAK)
 * - Offscreen canvas kolon blit (FAZ 5.1 temeli)
 * - sample(bookSnapshot) ile depth data ingestion
 */

import {
  HeatmapBin,
  HeatmapConfig,
  HeatmapRenderStats,
  Viewport,
  DEFAULT_HEATMAP_CONFIG,
} from "../shared/types";

// ─────────────────────────────────────────────
// PLASMA COLOR LUT (256 entries, pre-computed)
// ─────────────────────────────────────────────

function buildPlasmaLUT(size: number): Uint8ClampedArray {
  // RGBA × size = 4 * size bytes
  const lut = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1); // 0..1

    // ── Plasma palette (approximation) ──
    // Low intensity: dark blue → purple → red → orange → yellow
    const r = Math.round(Math.min(255, Math.max(0,
      255 * (0.0504 + t * (3.086 + t * (-4.698 + t * 2.562)))
    )));
    const g = Math.round(Math.min(255, Math.max(0,
      255 * (0.0298 + t * (-0.358 + t * (1.533 + t * (-0.205))))
    )));
    const b = Math.round(Math.min(255, Math.max(0,
      255 * (0.527 + t * (1.257 + t * (-4.086 + t * 3.303)))
    )));
    const a = Math.round(Math.min(255, Math.max(0,
      t < 0.05 ? t * 20 * 255 : 255 // Fade in for very low values
    )));

    lut[i * 4 + 0] = r;
    lut[i * 4 + 1] = g;
    lut[i * 4 + 2] = b;
    lut[i * 4 + 3] = a;
  }
  return lut;
}

// ─────────────────────────────────────────────
// HEATMAP BIN STORAGE (Float64Array ring buffer)
// ─────────────────────────────────────────────

interface BinGrid {
  /** data[timeIdx * priceCount + priceIdx] = notional value */
  data: Float64Array;
  /** data[timeIdx * priceCount + priceIdx] = 0=bid, 1=ask */
  side: Uint8Array;
  timeCount: number;
  priceCount: number;
  timeLabels: number[]; // unix timestamps per column
  priceLabels: number[]; // prices per row
  headTimeIdx: number; // ring buffer head for time axis
}

// ─────────────────────────────────────────────
// LIQUIDITY HEATMAP
// ─────────────────────────────────────────────

export class LiquidityHeatmap {
  private readonly config: HeatmapConfig;
  private readonly colorLUT: Uint8ClampedArray;
  private grid: BinGrid | null = null;

  // ── Offscreen canvas state (PING-PONG: 2 canvas, self-draw YASAK) ──
  private offscreenA: HTMLCanvasElement | null = null;
  private offscreenCtxA: CanvasRenderingContext2D | null = null;
  private offscreenB: HTMLCanvasElement | null = null;
  private offscreenCtxB: CanvasRenderingContext2D | null = null;
  private activeOffscreen: "A" | "B" = "A";
  private offscreenValid: boolean = false;

  // ── Stats ──
  private lastDrawnCells: number = 0;
  private lastCulledCells: number = 0;

  constructor(config?: Partial<HeatmapConfig>) {
    this.config = { ...DEFAULT_HEATMAP_CONFIG, ...config };
    this.colorLUT = buildPlasmaLUT(this.config.lutSize);
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Depth snapshot'tan heatmap verisi al.
   * Her çağrıda yeni bir zaman kolonu eklenir.
   */
  public sample(
    bids: ReadonlyMap<number, number>,
    asks: ReadonlyMap<number, number>,
    timestamp: number,
    priceBinSize: number
  ): void {
    // ── Grid ilk kez oluşturuluyorsa ──
    if (!this.grid) {
      this.initGrid(priceBinSize, timestamp);
    }

    if (!this.grid) return;

    const grid = this.grid;
    const timeIdx = this.advanceTimeColumn(timestamp);

    // ── Bid seviyelerini kovala ──
    for (const [price, qty] of bids) {
      const priceIdx = this.priceToIdx(price, grid);
      if (priceIdx >= 0 && priceIdx < grid.priceCount) {
        const idx = timeIdx * grid.priceCount + priceIdx;
        grid.data[idx] += price * qty; // notional
        grid.side[idx] = 0; // bid
      }
    }

    // ── Ask seviyelerini kovala ──
    for (const [price, qty] of asks) {
      const priceIdx = this.priceToIdx(price, grid);
      if (priceIdx >= 0 && priceIdx < grid.priceCount) {
        const idx = timeIdx * grid.priceCount + priceIdx;
        grid.data[idx] += price * qty; // notional
        grid.side[idx] = 1; // ask
      }
    }

    // ── Offscreen cache invalidate (yeni kolon geldi) ──
    this.offscreenValid = false;
  }

  /**
   * Ana render fonksiyonu. Viewport culling aktif.
   */
  public render(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport
  ): HeatmapRenderStats {
    // ── Koruma: geçersiz viewport ──
    if (viewport.width <= 0 || viewport.height <= 0 ||
        viewport.minPrice >= viewport.maxPrice) {
      return { drawnCells: 0, culledCells: 0, totalBins: 0, offscreenBlitUsed: false };
    }

    if (!this.grid) {
      return { drawnCells: 0, culledCells: 0, totalBins: 0, offscreenBlitUsed: false };
    }

    const grid = this.grid;
    let drawnCells = 0;
    let culledCells = 0;

    // ── Normalizasyon: max notional bul ──
    let maxNotional = this.config.maxNotionalForNormalization;
    if (maxNotional <= 0) {
      maxNotional = this.findMaxNotional(grid);
    }
    if (maxNotional <= 0) {
      return { drawnCells: 0, culledCells: 0, totalBins: grid.timeCount * grid.priceCount, offscreenBlitUsed: false };
    }

    const lutMax = this.config.lutSize - 1;
    const cellWidth = viewport.width / grid.timeCount;
    const now = Date.now();

    // ── Her zaman kolonu için ──
    for (let t = 0; t < grid.timeCount; t++) {
      // ── Zaman kolonunun X pozisyonu ──
      const realTimeIdx = (grid.headTimeIdx + t + 1) % grid.timeCount;
      const colTime = grid.timeLabels[realTimeIdx] ?? 0;
      const x = viewport.timeToX(colTime);

      // ── Time culling: görünmeyen kolonları atla ──
      if (x + cellWidth < 0 || x > viewport.width) {
        culledCells += grid.priceCount;
        continue;
      }

      // ── Her fiyat satırı için ──
      for (let p = 0; p < grid.priceCount; p++) {
        const idx = realTimeIdx * grid.priceCount + p;
        const notional = grid.data[idx];

        if (notional <= 0) {
          culledCells++;
          continue;
        }

        const price = grid.priceLabels[p];

        // ── VIEWPORT CULLING: görünmeyen fiyat = fillRect YASAK ──
        if (price < viewport.minPrice || price > viewport.maxPrice) {
          culledCells++;
          continue;
        }

        // ── Y pozisyonu ──
        const y = viewport.priceToY(price);
        if (!Number.isFinite(y)) {
          culledCells++;
          continue;
        }

        // ── LUT index hesapla (log-scale) ──
        const normalized = notional / maxNotional;
        const logNorm = Math.log(1 + normalized * 9) / Math.log(10); // log10 scale
        const lutIdx = Math.min(lutMax, Math.max(0, Math.round(logNorm * lutMax)));

        // ── LUT'tan renk oku (string birleştirme YASAK) ──
        const r = this.colorLUT[lutIdx * 4 + 0];
        const g = this.colorLUT[lutIdx * 4 + 1];
        const b = this.colorLUT[lutIdx * 4 + 2];
        const a = this.colorLUT[lutIdx * 4 + 3];

        // ── Bid yeşil tint, Ask kırmızı tint ──
        const isBid = grid.side[idx] === 0;

        ctx.fillStyle = isBid
          ? `rgba(${Math.round(r * 0.3)},${Math.round(g * 0.8 + 50)},${Math.round(b * 0.3)},${(a / 255 * 0.7).toFixed(2)})`
          : `rgba(${Math.round(r * 0.8 + 50)},${Math.round(g * 0.3)},${Math.round(b * 0.3)},${(a / 255 * 0.7).toFixed(2)})`;

        const cellHeight = Math.max(1, Math.abs(
          viewport.priceToY(price + (grid.priceLabels[1] ?? 1) - (grid.priceLabels[0] ?? 0)) - y
        ));

        ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(cellWidth), Math.ceil(cellHeight));
        drawnCells++;
      }
    }

    this.lastDrawnCells = drawnCells;
    this.lastCulledCells = culledCells;

    return {
      drawnCells,
      culledCells,
      totalBins: grid.timeCount * grid.priceCount,
      offscreenBlitUsed: false,
    };
  }

  /**
   * Offscreen canvas ile optimize edilmiş render.
   * DÜZELTME #1 (FAZ 4): Ping-pong pattern — self-draw YASAK.
   * Canvas A ve Canvas B arasında swap: eski → yeni, sonra ana canvas'a blit.
   */
  public renderOffscreen(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport
  ): HeatmapRenderStats {
    if (viewport.width <= 0 || viewport.height <= 0 ||
        viewport.minPrice >= viewport.maxPrice) {
      return { drawnCells: 0, culledCells: 0, totalBins: 0, offscreenBlitUsed: false };
    }

    if (!this.grid) {
      return { drawnCells: 0, culledCells: 0, totalBins: 0, offscreenBlitUsed: false };
    }

    // ── Offscreen canvas çiftini oluştur/yeniden boyutlandır ──
    if (!this.offscreenA || this.offscreenA.width !== viewport.width || this.offscreenA.height !== viewport.height) {
      this.offscreenA = this.createCanvas(viewport.width, viewport.height);
      this.offscreenCtxA = this.offscreenA.getContext("2d");
      this.offscreenB = this.createCanvas(viewport.width, viewport.height);
      this.offscreenCtxB = this.offscreenB.getContext("2d");
      this.offscreenValid = false;
    }

    const srcCanvas = this.activeOffscreen === "A" ? this.offscreenA : this.offscreenB;
    const srcCtx = this.activeOffscreen === "A" ? this.offscreenCtxA : this.offscreenCtxB;
    const dstCanvas = this.activeOffscreen === "A" ? this.offscreenB : this.offscreenA;
    const dstCtx = this.activeOffscreen === "A" ? this.offscreenCtxB : this.offscreenCtxA;

    if (!srcCtx || !dstCtx) {
      return this.render(ctx, viewport);
    }

    // ── Yeni kolon geldiyse, PING-PONG blit ──
    if (!this.offscreenValid && this.grid) {
      const cellWidth = viewport.width / this.grid.timeCount;

      // ── DST = SRC'yi sola kaydır + yeni kolon çiz ──
      dstCtx.clearRect(0, 0, viewport.width, viewport.height);
      if (srcCanvas) dstCtx.drawImage(srcCanvas, -cellWidth, 0); // SRC → DST (farklı canvas, güvenli)

      // ── Yeni kolonu DST'nin sağına çiz ──
      const newColIdx = this.grid.headTimeIdx;
      const drawn = this.renderColumn(dstCtx, viewport, newColIdx, viewport.width - cellWidth, cellWidth);

      // ── Swap: aktif offscreen = DST ──
      this.activeOffscreen = this.activeOffscreen === "A" ? "B" : "A";
      this.offscreenValid = true;
      this.lastDrawnCells = drawn;
    }

    // ── Ana canvas'a blit (aktif offscreen'den) ──
    const finalCanvas = this.activeOffscreen === "A" ? this.offscreenA : this.offscreenB;
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (finalCanvas) ctx.drawImage(finalCanvas, 0, 0);

    return {
      drawnCells: this.lastDrawnCells,
      culledCells: this.lastCulledCells,
      totalBins: this.grid.timeCount * this.grid.priceCount,
      offscreenBlitUsed: true,
    };
  }

  /**
   * Grid'i tamamen sıfırla.
   */
  public reset(): void {
    this.grid = null;
    this.offscreenValid = false;
    this.offscreenA = null;
    this.offscreenCtxA = null;
    this.offscreenB = null;
    this.offscreenCtxB = null;
    this.activeOffscreen = "A";
    this.lastDrawnCells = 0;
    this.lastCulledCells = 0;
  }

  public getGrid(): BinGrid | null { return this.grid; }
  public getLastStats(): { drawnCells: number; culledCells: number } {
    return { drawnCells: this.lastDrawnCells, culledCells: this.lastCulledCells };
  }

  // ─────────────────────────────────────────────
  // PRIVATE: GRID MANAGEMENT
  // ─────────────────────────────────────────────

  private initGrid(priceBinSize: number, startTime: number): void {
    const timeCount = Math.ceil(this.config.timeWindowSec / this.config.binIntervalSec);
    const effectiveBinSize = priceBinSize > 0 ? priceBinSize : 1;

    // ── Fiyat aralığı: geniş başlat, runtime'da daralacak ──
    const priceRange = 1000; // Placeholder — gerçek değer sample'da belirlenir
    const priceCount = Math.min(500, Math.ceil(priceRange / effectiveBinSize));

    const data = new Float64Array(timeCount * priceCount);
    const side = new Uint8Array(timeCount * priceCount);
    const timeLabels = new Array(timeCount).fill(0);
    const priceLabels = new Array(priceCount).fill(0);

    this.grid = {
      data, side, timeCount, priceCount,
      timeLabels, priceLabels,
      headTimeIdx: 0,
    };
  }

  /**
   * Grid'i gerçek fiyat aralığına göre yeniden boyutlandır.
   */
  public reinitGrid(
    priceBinSize: number,
    minPrice: number,
    maxPrice: number,
    startTime: number
  ): void {
    if (maxPrice <= minPrice || priceBinSize <= 0) return;

    const timeCount = Math.ceil(this.config.timeWindowSec / this.config.binIntervalSec);
    const priceCount = Math.min(500, Math.ceil((maxPrice - minPrice) / priceBinSize));

    const data = new Float64Array(timeCount * priceCount);
    const side = new Uint8Array(timeCount * priceCount);
    const timeLabels = new Array(timeCount).fill(0);
    const priceLabels: number[] = new Array(priceCount);

    for (let i = 0; i < priceCount; i++) {
      priceLabels[i] = minPrice + i * priceBinSize;
    }

    this.grid = {
      data, side, timeCount, priceCount,
      timeLabels, priceLabels,
      headTimeIdx: 0,
    };
    this.offscreenValid = false;
  }

  private advanceTimeColumn(timestamp: number): number {
    if (!this.grid) return 0;
    const grid = this.grid;

    // ── Ring buffer: head'i ilerlet ──
    grid.headTimeIdx = (grid.headTimeIdx + 1) % grid.timeCount;
    grid.timeLabels[grid.headTimeIdx] = timestamp;

    // ── Yeni kolonu sıfırla ──
    const start = grid.headTimeIdx * grid.priceCount;
    for (let p = 0; p < grid.priceCount; p++) {
      grid.data[start + p] = 0;
      grid.side[start + p] = 0;
    }

    return grid.headTimeIdx;
  }

  private priceToIdx(price: number, grid: BinGrid): number {
    if (grid.priceLabels.length === 0) return -1;
    const basePrice = grid.priceLabels[0];
    const binSize = grid.priceLabels.length > 1
      ? grid.priceLabels[1] - grid.priceLabels[0]
      : 1;
    if (binSize <= 0) return -1;
    return Math.round((price - basePrice) / binSize);
  }

  private findMaxNotional(grid: BinGrid): number {
    let max = 0;
    for (let i = 0; i < grid.data.length; i++) {
      if (grid.data[i] > max) max = grid.data[i];
    }
    return max;
  }

  // ─────────────────────────────────────────────
  // PRIVATE: OFFSCREEN COLUMN RENDER
  // ─────────────────────────────────────────────

  private renderColumn(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    timeIdx: number,
    x: number,
    cellWidth: number
  ): number {
    if (!this.grid) return 0;
    const grid = this.grid;
    let drawn = 0;
    const maxNotional = this.findMaxNotional(grid);
    if (maxNotional <= 0) return 0;

    const lutMax = this.config.lutSize - 1;

    for (let p = 0; p < grid.priceCount; p++) {
      const idx = timeIdx * grid.priceCount + p;
      const notional = grid.data[idx];
      if (notional <= 0) continue;

      const price = grid.priceLabels[p];
      if (price < viewport.minPrice || price > viewport.maxPrice) continue;

      const y = viewport.priceToY(price);
      if (!Number.isFinite(y)) continue;

      const normalized = notional / maxNotional;
      const logNorm = Math.log(1 + normalized * 9) / Math.log(10);
      const lutIdx = Math.min(lutMax, Math.max(0, Math.round(logNorm * lutMax)));

      const r = this.colorLUT[lutIdx * 4 + 0];
      const g = this.colorLUT[lutIdx * 4 + 1];
      const b = this.colorLUT[lutIdx * 4 + 2];
      const a = this.colorLUT[lutIdx * 4 + 3];

      const isBid = grid.side[idx] === 0;
      ctx.fillStyle = isBid
        ? `rgba(${Math.round(r * 0.3)},${Math.round(g * 0.8 + 50)},${Math.round(b * 0.3)},${(a / 255 * 0.7).toFixed(2)})`
        : `rgba(${Math.round(r * 0.8 + 50)},${Math.round(g * 0.3)},${Math.round(b * 0.3)},${(a / 255 * 0.7).toFixed(2)})`;

      const cellHeight = Math.max(1, Math.abs(
        viewport.priceToY(price + (grid.priceLabels[1] ?? 1) - (grid.priceLabels[0] ?? 0)) - y
      ));

      ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(cellWidth), Math.ceil(cellHeight));
      drawn++;
    }

    return drawn;
  }

  /**
   * Platform-agnostic canvas creation (test edilebilirlik için).
   */
  private createCanvas(width: number, height: number): HTMLCanvasElement {
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    // ── Node.js/test ortamı: minimal mock ──
    return {
      width, height,
      getContext: () => createMockCtx(),
    } as unknown as HTMLCanvasElement;
  }
}

// ─────────────────────────────────────────────
// MOCK CANVAS CONTEXT (Headless Testing)
// ─────────────────────────────────────────────

function createMockCtx(): CanvasRenderingContext2D {
  let fillCount = 0;
  let lastFillStyle = "";

  return {
    fillStyle: "",
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillCount++;
      lastFillStyle = (createMockCtx as unknown as { fillStyle: string }).fillStyle ?? "";
    },
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    getFillCount: () => fillCount,
  } as unknown as CanvasRenderingContext2D;
}
