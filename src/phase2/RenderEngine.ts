/**
 * PREDATOR TERMINAL - FAZ 2: RenderEngine
 * ===========================================
 * Dirty-Flag katmanlı requestAnimationFrame döngüsü.
 *
 * 4 Katman: hud, heatmap, depthOverlay, annotations
 * mark(layer) → dirty=true → sadece dirty katmanlar çizilir
 * Frame süresi > 16.6ms → frameDropCount++
 * registerRenderer(layer, fn) ile pluggable render fonksiyonları
 */

import {
  RenderLayer,
  Viewport,
  RenderStats,
  RenderFunction,
} from "../shared/types";

// ─────────────────────────────────────────────
// RENDER ENGINE
// ─────────────────────────────────────────────

export class RenderEngine {
  private readonly layers: Map<RenderLayer, LayerState> = new Map();
  private readonly dirtyFlags: Map<RenderLayer, boolean> = new Map();
  private readonly layerData: Map<RenderLayer, unknown> = new Map();

  private rafId: number | null = null;
  private running: boolean = false;
  private lastFrameTime: number = 0;
  private frameDropCount: number = 0;
  private totalFrames: number = 0;
  private frameTimeAccumulator: number = 0;
  private frameTimeSampleCount: number = 0;

  /** Platform rAF abstraction (test edilebilirlik için) */
  private readonly requestAnimationFrame: (cb: (time: number) => void) => number;
  private readonly cancelAnimationFrame: (id: number) => void;

  constructor(
    rafFn?: (cb: (time: number) => void) => number,
    cafFn?: (id: number) => void
  ) {
    this.requestAnimationFrame = rafFn ?? (globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number));
    this.cancelAnimationFrame = cafFn ?? (globalThis.cancelAnimationFrame?.bind(globalThis) ?? ((id) => clearTimeout(id)));

    // ── 4 katmanı başlat ──
    for (const layer of Object.values(RenderLayer)) {
      this.dirtyFlags.set(layer, false);
    }
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Bir katman için render fonksiyonu ve canvas context kaydet.
   */
  public registerRenderer(
    layer: RenderLayer,
    ctx: CanvasRenderingContext2D,
    renderFn: RenderFunction
  ): void {
    this.layers.set(layer, { ctx, renderFn });
    this.dirtyFlags.set(layer, false);
  }

  /**
   * Bir katmanı dirty olarak işaretle.
   * Sadece dirty katmanlar bir sonraki frame'de çizilir.
   */
  public mark(layer: RenderLayer): void {
    this.dirtyFlags.set(layer, true);
  }

  /**
   * Bir katmanın render verisini güncelle.
   * mark() ayrıca çağrılmalı.
   */
  public setData(layer: RenderLayer, data: unknown): void {
    this.layerData.set(layer, data);
  }

  /**
   * Render + data set + mark hepsini tek çağrıda.
   */
  public update(layer: RenderLayer, data: unknown): void {
    this.layerData.set(layer, data);
    this.dirtyFlags.set(layer, true);
  }

  /**
   * Render döngüsünü başlat.
   */
  public start(viewport: Viewport): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.loop(viewport);
  }

  /**
   * Render döngüsünü durdur.
   */
  public stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      this.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Anlık istatistikler.
   */
  public getStats(): RenderStats {
    const dirtyLayers = new Set<RenderLayer>();
    for (const [layer, dirty] of this.dirtyFlags) {
      if (dirty) dirtyLayers.add(layer);
    }
    return {
      frameTimeMs: this.frameTimeSampleCount > 0
        ? this.frameTimeAccumulator / this.frameTimeSampleCount
        : 0,
      frameDropCount: this.frameDropCount,
      totalFrames: this.totalFrames,
      dirtyLayers,
    };
  }

  /**
   * İstatistikleri sıfırla.
   */
  public resetStats(): void {
    this.frameDropCount = 0;
    this.totalFrames = 0;
    this.frameTimeAccumulator = 0;
    this.frameTimeSampleCount = 0;
  }

  /**
   * Tüm dirty flag'leri temizle (force full redraw bir sonraki frame'de).
   */
  public markAll(): void {
    for (const layer of Object.values(RenderLayer)) {
      this.dirtyFlags.set(layer, true);
    }
  }

  /**
   * Tek bir frame'i manuel çiz (test ve screenshot için).
   */
  public renderOnce(viewport: Viewport): RenderStats {
    this.renderFrame(performance.now(), viewport);
    return this.getStats();
  }

  // ─────────────────────────────────────────────
  // PRIVATE: RENDER LOOP
  // ─────────────────────────────────────────────

  private loop(viewport: Viewport): void {
    if (!this.running) return;

    this.rafId = this.requestAnimationFrame((timestamp: number) => {
      this.renderFrame(timestamp, viewport);
      this.loop(viewport);
    });
  }

  private renderFrame(timestamp: number, viewport: Viewport): void {
    const frameStart = timestamp;

    // ── Frame time tracking ──
    if (this.lastFrameTime > 0) {
      const delta = timestamp - this.lastFrameTime;
      this.frameTimeAccumulator += delta;
      this.frameTimeSampleCount++;

      // ── Frame drop: delta > 16.6ms (60 FPS) ──
      if (delta > 16.6) {
        this.frameDropCount++;
      }
    }
    this.lastFrameTime = timestamp;
    this.totalFrames++;

    // ── Sadece dirty katmanları çiz ──
    for (const layer of Object.values(RenderLayer)) {
      if (!this.dirtyFlags.get(layer)) continue;

      const state = this.layers.get(layer);
      if (!state) {
        // Renderer kayıtlı değil, flag'i temizle
        this.dirtyFlags.set(layer, false);
        continue;
      }

      const data = this.layerData.get(layer) ?? null;

      try {
        state.renderFn(state.ctx, viewport, data);
      } catch (err) {
        console.error(`[RenderEngine] Render error on layer '${layer}':`, err);
      }

      // ── Çizim bitti, flag'i temizle ──
      this.dirtyFlags.set(layer, false);
    }
  }
}

// ─────────────────────────────────────────────
// LAYER STATE (Internal)
// ─────────────────────────────────────────────

interface LayerState {
  ctx: CanvasRenderingContext2D;
  renderFn: RenderFunction;
}
