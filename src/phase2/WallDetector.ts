/**
 * PREDATOR TERMINAL - FAZ 2: WallDetector
 * ===========================================
 * P90 persantil + %58 dominans ile duvar tespiti.
 *
 * Algoritma:
 * 1. Son 100 seviyenin notional değerlerini topla
 * 2. Küçükten büyüğe sırala
 * 3. P90 eşiği: notionals[floor(len * 0.90)]
 * 4. Duvar: notional >= P90 AND dominanceRatio >= 0.58
 * 5. Cluster merge: 5 BPS içindeki duvarları birleştir
 */

import {
  WallCluster,
  WallSide,
  WallDetectorConfig,
  DEFAULT_WALL_CONFIG,
} from "../shared/types";

export class WallDetector {
  private readonly config: WallDetectorConfig;

  /** Persistent wall tracking: price → firstSeen timestamp */
  private readonly wallTracker: Map<string, number> = new Map();

  /**
   * DÜZELTME #2 (FAZ 4): Sembol bazlı dinamik cluster merge BPS.
   * BTC: 2 BPS, DOGE: 10 BPS, DEFAULT: 5 BPS
   */
  private symbolMergeBps: Map<string, number> = new Map([
    ["BTCUSDT", 2],
    ["ETHUSDT", 3],
    ["BNBUSDT", 4],
    ["SOLUSDT", 5],
    ["DOGEUSDT", 10],
    ["SHIBUSDT", 15],
    ["PEPEUSDT", 10],
  ]);
  private currentSymbol: string = "";

  constructor(config?: Partial<WallDetectorConfig>) {
    this.config = { ...DEFAULT_WALL_CONFIG, ...config };
  }

  /** Sembol bazlı merge BPS ayarla */
  public setSymbol(symbol: string): void {
    this.currentSymbol = symbol.toUpperCase();
  }

  /** Bir sembol için merge BPS al */
  public getMergeBps(symbol?: string): number {
    const s = (symbol ?? this.currentSymbol).toUpperCase();
    return this.symbolMergeBps.get(s) ?? this.config.clusterMergeBps;
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Order book'tan duvar kümelerini hesapla.
   *
   * @param bids - price → quantity map
   * @param asks - price → quantity map
   * @param timestamp - Şu anki zaman (ms)
   * @returns Tespit edilen duvar kümeleri
   */
  public computeWallClusters(
    bids: ReadonlyMap<number, number>,
    asks: ReadonlyMap<number, number>,
    timestamp: number
  ): WallCluster[] {
    // ── 1. Seviyeleri topla ──
    const levels = this.collectLevels(bids, asks);
    if (levels.length === 0) return [];

    // ── 2. Notional değerleri sırala → P90 eşiği ──
    const notionals = levels.map((l) => l.notional).sort((a, b) => a - b);
    const p90Index = Math.floor(notionals.length * this.config.percentileThreshold);
    const p90Threshold = notionals[p90Index];

    if (p90Threshold <= 0) return [];

    // ── 3. Bid/Ask toplam notional ──
    let totalBidNotional = 0;
    let totalAskNotional = 0;
    for (const level of levels) {
      if (level.side === "bid") totalBidNotional += level.notional;
      else totalAskNotional += level.notional;
    }
    const totalBookNotional = totalBidNotional + totalAskNotional;

    if (totalBookNotional <= 0) return [];

    // ── 4. Duvar adaylarını filtrele ──
    const candidates: WallCandidate[] = [];
    for (const level of levels) {
      if (level.notional < p90Threshold) continue;

      // ── Dominans: bu seviyedeki tarafın toplam notional'a oranı ──
      const sideTotal = level.side === "bid" ? totalBidNotional : totalAskNotional;
      const dominanceRatio = sideTotal > 0 ? level.notional / sideTotal : 0;

      if (dominanceRatio >= this.config.minDominanceRatio) {
        candidates.push({
          price: level.price,
          side: level.side,
          notional: level.notional,
          quantity: level.quantity,
          dominanceRatio,
          p90Threshold,
        });
      }
    }

    // ── 5. Cluster merge: yakın fiyatları birleştir (DÜZELTME: sembol bazlı BPS) ──
    const merged = this.mergeClusters(candidates, this.getMergeBps());

    // ── 6. Persistent wall tracking ──
    const now = timestamp;
    const results: WallCluster[] = [];

    for (const m of merged) {
      const key = `${m.side}:${m.price}`;
      let firstSeen = this.wallTracker.get(key);

      if (!firstSeen) {
        firstSeen = now;
        this.wallTracker.set(key, now);
      }

      const ageSec = (now - firstSeen) / 1000;
      const isPersistent = ageSec >= this.config.persistentThresholdSec;

      results.push({
        price: m.price,
        side: m.side,
        notional: m.notional,
        quantity: m.quantity,
        dominanceRatio: m.dominanceRatio,
        p90Threshold: m.p90Threshold,
        firstSeen,
        ageSec,
        isPersistent,
      });
    }

    // ── 7. Artık var olmayan duvarları temizle ──
    this.pruneStaleWalls(merged, now);

    return results;
  }

  /**
   * Persistent wall tracker'ı sıfırla.
   */
  public reset(): void {
    this.wallTracker.clear();
  }

  /**
   * Şu anki tracked wall sayısı.
   */
  public getTrackedWallCount(): number {
    return this.wallTracker.size;
  }

  // ─────────────────────────────────────────────
  // PRIVATE: LEVEL COLLECTION
  // ─────────────────────────────────────────────

  private collectLevels(
    bids: ReadonlyMap<number, number>,
    asks: ReadonlyMap<number, number>
  ): LevelEntry[] {
    const levels: LevelEntry[] = [];
    const maxLevels = this.config.maxLevels;

    // ── Bid'leri topla (fiyata göre descending, en iyi bid'ler önce) ──
    const bidEntries = [...bids.entries()]
      .sort((a, b) => b[0] - a[0])
      .slice(0, maxLevels);

    for (const [price, qty] of bidEntries) {
      if (qty > 0 && Number.isFinite(price) && Number.isFinite(qty)) {
        levels.push({ price, quantity: qty, notional: price * qty, side: "bid" });
      }
    }

    // ── Ask'ları topla (fiyata göre ascending, en iyi ask'lar önce) ──
    const askEntries = [...asks.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, maxLevels);

    for (const [price, qty] of askEntries) {
      if (qty > 0 && Number.isFinite(price) && Number.isFinite(qty)) {
        levels.push({ price, quantity: qty, notional: price * qty, side: "ask" });
      }
    }

    return levels;
  }

  // ─────────────────────────────────────────────
  // PRIVATE: CLUSTER MERGE
  // ─────────────────────────────────────────────

  private mergeClusters(candidates: WallCandidate[], mergeBps: number): WallCandidate[] {
    if (candidates.length === 0) return [];

    // ── Taraf ve fiyata göre sırala ──
    const sorted = [...candidates].sort((a, b) => {
      if (a.side !== b.side) return a.side === "bid" ? -1 : 1;
      return a.price - b.price;
    });

    const merged: WallCandidate[] = [];
    let current: WallCandidate = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      if (next.side !== current.side) {
        merged.push(current);
        current = { ...next };
        continue;
      }

      // ── BPS mesafe kontrolü ──
      const midPrice = (current.price + next.price) * 0.5;
      if (midPrice <= 0) {
        merged.push(current);
        current = { ...next };
        continue;
      }

      const bpsDistance = (Math.abs(next.price - current.price) / midPrice) * 10000;

      if (bpsDistance <= mergeBps) {
        // ── Merge: ağırlıklı ortalama fiyat, toplam notional ──
        const totalNotional = current.notional + next.notional;
        const weightedPrice = (current.price * current.notional + next.price * next.notional) / totalNotional;

        current = {
          price: weightedPrice,
          side: current.side,
          notional: totalNotional,
          quantity: current.quantity + next.quantity,
          dominanceRatio: Math.max(current.dominanceRatio, next.dominanceRatio),
          p90Threshold: current.p90Threshold,
        };
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }

  // ─────────────────────────────────────────────
  // PRIVATE: STALE WALL PRUNING
  // ─────────────────────────────────────────────

  private pruneStaleWalls(currentWalls: WallCandidate[], now: number): void {
    const activeKeys = new Set(currentWalls.map((w) => `${w.side}:${w.price}`));

    for (const [key] of this.wallTracker) {
      if (!activeKeys.has(key)) {
        this.wallTracker.delete(key);
      }
    }
  }
}

// ─────────────────────────────────────────────
// INTERNAL TYPES
// ─────────────────────────────────────────────

interface LevelEntry {
  price: number;
  quantity: number;
  notional: number;
  side: WallSide;
}

interface WallCandidate {
  price: number;
  side: WallSide;
  notional: number;
  quantity: number;
  dominanceRatio: number;
  p90Threshold: number;
}
