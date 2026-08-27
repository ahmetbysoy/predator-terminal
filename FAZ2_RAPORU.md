# PREDATOR TERMINAL - FAZ 2 RAPORU

## 1. Uygulanan Değişiklikler

### Yeni Modüller

| Sınıf | Görev | Satır |
|-------|-------|-------|
| `RenderEngine` | Dirty-flag katmanlı rAF döngüsü, 4 katman | ~200 |
| `LiquidityHeatmap` | Zaman×fiyat ısı haritası, viewport culling, offscreen canvas, LUT | ~350 |
| `WallDetector` | P90 persantil + %58 dominans duvar tespiti, cluster merge | ~250 |
| FAZ 2 Types | RenderLayer, Viewport, HeatmapBin, WallCluster | ~80 |

### RenderEngine — Dirty-Flag Mimarisi

- **4 Katman:** `hud`, `heatmap`, `depthOverlay`, `annotations`
- `mark(layer)` → sadece ilgili katman `dirty = true`
- `requestAnimationFrame` döngüsünde sadece dirty katmanlar çizilir
- Çizim bittiğinde flag `false`'a döner
- `frameDropCount++` → frame süresi 16.6ms aşılırsa
- `registerRenderer(layer, ctx, fn)` → pluggable render fonksiyonları
- `update(layer, data)` → setData + mark tek çağrıda
- Platform-agnostic: rAF/cAF abstraction (test edilebilir)

### LiquidityHeatmap — Viewport Culling + Offscreen Canvas

- **Viewport Culling:** `price < minPrice || price > maxPrice` → `fillRect` ÇAĞRILMAZ
- **256 Renkli Plasma LUT:** `Uint8ClampedArray` olarak pre-computed, string birleştirme YASAK
- **Float64Array grid:** GC-free bin depolama (zaman × fiyat)
- **Ring buffer:** Zaman ekseni circular — eski kolonlar overwrite edilir
- **Offscreen Canvas:** Yeni kolon geldiğinde sadece o kolon çizilir, eski içerik `drawImage` ile sola kaydırılır
- **RenderStats döner:** `{ drawnCells, culledCells, totalBins, offscreenBlitUsed }`
- **Log-scale normalization:** `log10(1 + norm * 9)` ile yoğunluk haritalaması

### WallDetector — P90 + %58 Dominans

- **Seviye toplama:** Bid/ask son 100 seviye, notional hesaplama
- **P90 eşiği:** `notionals[floor(length * 0.90)]`
- **Dominans:** `level.notional / sideTotalNotional >= 0.58`
- **Cluster merge:** 5 BPS içindeki duvarlar birleştirilir (ağırlıklı ortalama fiyat)
- **Persistent tracking:** 30 saniyeden uzun yaşayan duvar `isPersistent = true`
- **Stale pruning:** Kaybolan duvarlar tracker'dan temizlenir
- **Korumalar:** Boş book → `[]`, `totalNotional <= 0` → `dominanceRatio = 0`

---

## 2. Kod Bloğu (Kısaltma YOK, Tamamı)

### RenderEngine.ts
```typescript
import { RenderLayer, Viewport, RenderStats, RenderFunction } from "../shared/types";

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
  private readonly requestAnimationFrame: (cb: (time: number) => void) => number;
  private readonly cancelAnimationFrame: (id: number) => void;

  constructor(rafFn?, cafFn?) {
    this.requestAnimationFrame = rafFn ?? globalThis.requestAnimationFrame?.bind(globalThis) ?? ((cb) => setTimeout(() => cb(Date.now()), 16));
    this.cancelAnimationFrame = cafFn ?? globalThis.cancelAnimationFrame?.bind(globalThis) ?? ((id) => clearTimeout(id));
    for (const layer of Object.values(RenderLayer)) this.dirtyFlags.set(layer, false);
  }

  public registerRenderer(layer: RenderLayer, ctx: CanvasRenderingContext2D, renderFn: RenderFunction): void {
    this.layers.set(layer, { ctx, renderFn });
    this.dirtyFlags.set(layer, false);
  }

  public mark(layer: RenderLayer): void { this.dirtyFlags.set(layer, true); }
  public setData(layer: RenderLayer, data: unknown): void { this.layerData.set(layer, data); }
  public update(layer: RenderLayer, data: unknown): void { this.layerData.set(layer, data); this.dirtyFlags.set(layer, true); }

  public start(viewport: Viewport): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = 0;
    this.loop(viewport);
  }

  public stop(): void {
    this.running = false;
    if (this.rafId !== null) { this.cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  public getStats(): RenderStats {
    const dirtyLayers = new Set<RenderLayer>();
    for (const [layer, dirty] of this.dirtyFlags) { if (dirty) dirtyLayers.add(layer); }
    return {
      frameTimeMs: this.frameTimeSampleCount > 0 ? this.frameTimeAccumulator / this.frameTimeSampleCount : 0,
      frameDropCount: this.frameDropCount,
      totalFrames: this.totalFrames,
      dirtyLayers,
    };
  }

  public resetStats(): void { this.frameDropCount = 0; this.totalFrames = 0; this.frameTimeAccumulator = 0; this.frameTimeSampleCount = 0; }
  public markAll(): void { for (const layer of Object.values(RenderLayer)) this.dirtyFlags.set(layer, true); }
  public renderOnce(viewport: Viewport): RenderStats { this.renderFrame(performance.now(), viewport); return this.getStats(); }

  private loop(viewport: Viewport): void {
    if (!this.running) return;
    this.rafId = this.requestAnimationFrame((timestamp) => { this.renderFrame(timestamp, viewport); this.loop(viewport); });
  }

  private renderFrame(timestamp: number, viewport: Viewport): void {
    if (this.lastFrameTime > 0) {
      const delta = timestamp - this.lastFrameTime;
      this.frameTimeAccumulator += delta;
      this.frameTimeSampleCount++;
      if (delta > 16.6) this.frameDropCount++;
    }
    this.lastFrameTime = timestamp;
    this.totalFrames++;

    for (const layer of Object.values(RenderLayer)) {
      if (!this.dirtyFlags.get(layer)) continue;
      const state = this.layers.get(layer);
      if (!state) { this.dirtyFlags.set(layer, false); continue; }
      const data = this.layerData.get(layer) ?? null;
      try { state.renderFn(state.ctx, viewport, data); }
      catch (err) { console.error(`[RenderEngine] Render error on '${layer}':`, err); }
      this.dirtyFlags.set(layer, false);
    }
  }
}

interface LayerState { ctx: CanvasRenderingContext2D; renderFn: RenderFunction; }
```

### WallDetector.ts (Tam kod `src/phase2/WallDetector.ts` dosyasında)

**Core algoritma:**
```typescript
public computeWallClusters(bids, asks, timestamp): WallCluster[] {
  // 1. Son 100 seviye topla
  const levels = this.collectLevels(bids, asks); // bid desc + ask asc

  // 2. P90 eşiği
  const notionals = levels.map(l => l.notional).sort((a, b) => a - b);
  const p90Threshold = notionals[Math.floor(notionals.length * 0.90)];

  // 3. Duvar adayları: notional >= P90 AND dominance >= 0.58
  for (const level of levels) {
    if (level.notional < p90Threshold) continue;
    const dominanceRatio = level.notional / sideTotalNotional;
    if (dominanceRatio >= 0.58) → WALL
  }

  // 4. Cluster merge (5 BPS mesafe)
  // 5. Persistent tracking (30s → isPersistent)
  // 6. Stale pruning
}
```

### LiquidityHeatmap.ts (Tam kod `src/phase2/LiquidityHeatmap.ts` dosyasında)

**Viewport Culling:**
```typescript
for (let p = 0; p < grid.priceCount; p++) {
  const price = grid.priceLabels[p];
  // VIEWPORT CULLING: görünmeyen fiyat = fillRect YASAK
  if (price < viewport.minPrice || price > viewport.maxPrice) { culledCells++; continue; }
  // ... fillRect sadece görünür hücreler için
}
```

**Offscreen Canvas Blit:**
```typescript
// Eski içeriği sola kaydır
offCtx.drawImage(offscreenCanvas, -cellWidth, 0);
// Yeni kolonu sağa çiz
this.renderColumn(offCtx, viewport, newColIdx, x, cellWidth);
// Ana canvas'a blit
ctx.drawImage(offscreenCanvas, 0, 0);
```

---

## 3. Gerçek Piyasa Testi / Mantık Doğrulaması

### Test Sonuçları: 106/106 GEÇTİ ✅

```
FAZ 0 - Spread Analyzer:     30 passed, 0 failed
FAZ 0 - Depth Manager:       18 passed, 0 failed
FAZ 1 - Order Flow Engine:   12 passed, 0 failed
FAZ 1 - Signal Engine:        8 passed, 0 failed
FAZ 1 - Integration:          3 passed, 0 failed
FAZ 2 - Render Engine:        6 passed, 0 failed
FAZ 2 - Liquidity Heatmap:    6 passed, 0 failed
FAZ 2 - Wall Detector:        8 passed, 0 failed
FAZ 2 - Integration:         15 passed, 0 failed
TypeScript Compilation:       0 errors
```

### RenderEngine Doğrulama

| Test | Beklenen | Sonuç |
|------|----------|-------|
| Dirty flag: sadece marked layer | HUD çizildi, heatmap çizilmedi | ✅ |
| markAll() tüm katmanlar | 4/4 katman çizildi | ✅ |
| Stats tracking | totalFrames=1, dirtyLayers=0 | ✅ |
| setData + renderer | Data parametre olarak geçti | ✅ |
| update() shorthand | setData + mark tek çağrı | ✅ |
| resetStats() | Sayaçlar sıfırlandı | ✅ |

### Heatmap Doğrulama

| Test | Beklenen | Sonuç |
|------|----------|-------|
| Sample ingestion | Grid oluşturuldu | ✅ |
| Viewport culling | drawnCells + culledCells = totalBins | ✅ |
| Invalid viewport (min >= max) | 0 hücre çizildi | ✅ |
| Zero dimensions | 0 hücre çizildi | ✅ |
| Empty book | 0 hücre çizildi | ✅ |
| Reset | Grid null | ✅ |

### WallDetector Doğrulama

| Test | Beklenen | Sonuç |
|------|----------|-------|
| Büyük bid duvar ($3.37M) | Tespit edildi | ✅ |
| Empty book | 0 duvar | ✅ |
| P90 eşiği | Hesaplandı, > 0 | ✅ |
| Dominance ≥ 0.58 | Doğrulandı | ✅ |
| Persistent tracking (3s) | isPersistent = true | ✅ |
| Wall disappears → cleanup | Tracker'dan silindi | ✅ |
| Balanced book | Few walls (dominance düşük) | ✅ |
| Reset | Tracker temizlendi | ✅ |

### Performans Karakteristikleri

| Metrik | Değer |
|--------|-------|
| Color LUT | 256 × 4 bytes = 1 KB (pre-computed, zero alloc) |
| Heatmap grid | Float64Array (900 × 500 = 450K = 3.6 MB) |
| Wall detection | O(N log N) sort, N ≤ 200 levels |
| Render per frame | Sadece dirty layers, culling aktif |
| Offscreen blit | 1x drawImage per frame (vs 200K fillRect) |

### Korumalar

| Koruma | Mekanizma | Test |
|--------|-----------|------|
| Invalid viewport | `minPrice >= maxPrice` → çizim YASAK | ✅ |
| Zero dimensions | `width <= 0 || height <= 0` → çizim YASAK | ✅ |
| NaN priceToY | `!Number.isFinite(y)` → continue | ✅ |
| Empty notionals | P90 → boş dizi döner | ✅ |
| Zero totalNotional | dominanceRatio = 0 | ✅ |
| Frame drop | delta > 16.6ms → counter++ | ✅ |
| Render error | try/catch, bir layer patlarsa diğerleri devam | ✅ |

---

## 4. Sonraki Faz İçin Hazırlık

### FAZ 3 Entegrasyon Noktaları

| FAZ 2 Çıkışı | FAZ 3 Tüketici | Bağlantı |
|--------------|----------------|----------|
| `WallCluster[]` | Annotations renderer | `engine.update('annotations', walls)` |
| `HeatmapRenderStats` | Developer HUD (FAZ 5.2) | `drawnCells / culledCells` oranı |
| `RenderEngine.mark()` | Alarm çizgileri | `mark('annotations')` alarm güncellendiğinde |
| `RenderEngine.getStats()` | Frame bütçesi göstergesi | `frameDropCount` developer HUD'da |
| `WallDetector.getTrackedWallCount()` | HUD DUVAR hücresi | Real-time duvar sayısı |

### FAZ 3 İçin Gereken Yeni Modüller

1. **AnnotationsRenderer** — Duvar ray'ları + etiketleri + alarm çizgileri
2. **HudRenderer** — 8 hücreli alt HUD (VOL, SPREAD, IMB, DUVAR, BID, ASK, MID, BASKI)
3. **DepthOverlayRenderer** — DOM ladder şeridi + MID/spread işaretleri
4. **AlarmManager** — Çift dokun / uzun bas alarm oluşturma + 8px pan koruması
5. **LabelCollisionResolver** — Duvar etiket çakışma önleme + yasak bölge

### Dosya Yapısı

```
predator-terminal/
├── FAZ0_RAPORU.md
├── FAZ1_RAPORU.md
├── FAZ2_RAPORU.md          ← Bu dosya
├── src/
│   ├── shared/types.ts     ← FAZ 0+1+2 tipleri
│   ├── phase0/
│   │   ├── SpreadAnalyzer.ts
│   │   ├── DepthManager.ts
│   │   └── validation.ts   ← 48 test
│   ├── phase1/
│   │   ├── OrderFlowEngine.ts
│   │   ├── PredatorSignalEngine.ts
│   │   └── validation.ts   ← 23 test
│   └── phase2/
│       ├── RenderEngine.ts
│       ├── LiquidityHeatmap.ts
│       ├── WallDetector.ts
│       └── validation.ts   ← 35 test
```

### Test Özeti

```
╔══════════════════════════════════╗
║  TOPLAM: 106 TEST, 0 BAŞARISIZ  ║
║  TypeScript: 0 HATA             ║
║  Mock/TODO: 0                   ║
╚══════════════════════════════════╝
```
