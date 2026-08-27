/**
 * PREDATOR TERMINAL - FAZ 5: KlineManager
 * ===========================================
 * Mum verisi yönetimi: REST history + WS canlı güncelleme.
 *
 * Denetçi Sorusu #4: "KlineManager nerede?"
 * Cevap: Burada. REST'ten 500 mum çeker, WS'ten canlı günceller.
 * PredatorSignalEngine.evaluate() için candles dizisi sağlar.
 */

export interface Candle {
  readonly time: number;     // Open time (unix ms)
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly closeTime: number;
  readonly isClosed: boolean;
}

export interface KlineManagerConfig {
  readonly restBaseUrl: string;
  readonly historyLimit: number;
  readonly maxCandles: number;
}

const DEFAULT_KLINE_CONFIG: KlineManagerConfig = {
  restBaseUrl: "https://api.binance.com",
  historyLimit: 500,
  maxCandles: 1000,
};

type FetchFn = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export class KlineManager {
  private readonly config: KlineManagerConfig;
  private readonly fetchFn: FetchFn;
  private candles: Candle[] = [];
  private currentSymbol: string = "";
  private currentInterval: string = "1m";
  private generationGuard: number = 0;

  constructor(config?: Partial<KlineManagerConfig>, fetchFn?: FetchFn) {
    this.config = { ...DEFAULT_KLINE_CONFIG, ...config };
    this.fetchFn = fetchFn ?? (globalThis.fetch?.bind(globalThis) as unknown as FetchFn);
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * REST API'den geçmiş mum verisi çeker.
   * Generation guard ile eski async cevapların yeni sembole yazmasını engeller.
   */
  public async loadHistory(
    symbol: string,
    interval: string = "1m",
    limit?: number
  ): Promise<Candle[]> {
    const gen = ++this.generationGuard;
    const ns = symbol.toUpperCase();
    const effectiveLimit = limit ?? this.config.historyLimit;

    const url = `${this.config.restBaseUrl}/api/v3/klines?symbol=${encodeURIComponent(ns)}&interval=${encodeURIComponent(interval)}&limit=${effectiveLimit}`;

    try {
      const response = await this.fetchFn(url);
      
      // ── Generation guard: eski cevap yeni sembolün üstüne yazmasın ──
      if (gen !== this.generationGuard) {
        console.warn(`[KlineManager] Stale response discarded for ${ns}`);
        return [];
      }

      if (!response.ok) {
        throw new Error(`HTTP error fetching klines for ${ns}`);
      }

      const raw = await response.json() as Array<[
        number,  // openTime
        string,  // open
        string,  // high
        string,  // low
        string,  // close
        string,  // volume
        number,  // closeTime
        string,  // quoteVolume
        number,  // trades
        string,  // takerBuyBaseVol
        string,  // takerBuyQuoteVol
        string   // ignore
      ]>;

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(`Empty kline response for ${ns}`);
      }

      this.currentSymbol = ns;
      this.currentInterval = interval;

      this.candles = raw.map((k) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
        isClosed: true,
      }));

      // ── Son mum henüz kapanmamış olabilir ──
      if (this.candles.length > 0) {
        const lastCandle = this.candles[this.candles.length - 1];
        if (Date.now() < lastCandle.closeTime) {
          (lastCandle as { isClosed: boolean }).isClosed = false;
        }
      }

      console.log(`[KlineManager] Loaded ${this.candles.length} candles for ${ns} (${interval})`);
      return this.getCandles();
    } catch (err) {
      console.error(`[KlineManager] Failed to load history for ${ns}:`, err);
      throw err;
    }
  }

  /**
   * WebSocket kline event'ini işler.
   * Binance format: { e:"kline", k: { t, T, s, i, o, h, l, c, v, x } }
   */
  public processKline(data: {
    k?: {
      t: number;   // open time
      T: number;   // close time
      s: string;   // symbol
      i: string;   // interval
      o: string;   // open
      h: string;   // high
      l: string;   // low
      c: string;   // close
      v: string;   // volume
      x: boolean;  // is closed
    };
  }): Candle | null {
    const k = data.k;
    if (!k) return null;

    // ── Symbol/interval guard ──
    if (k.s.toUpperCase() !== this.currentSymbol || k.i !== this.currentInterval) {
      return null;
    }

    const candle: Candle = {
      time: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closeTime: k.T,
      isClosed: k.x,
    };

    // ── Mevcut mumu güncelle veya yeni mum ekle ──
    if (this.candles.length > 0) {
      const lastCandle = this.candles[this.candles.length - 1];
      
      if (lastCandle.time === candle.time) {
        // ── Aynı mumu güncelle ──
        this.candles[this.candles.length - 1] = candle;
      } else if (candle.time > lastCandle.time) {
        // ── Yeni mum ekle ──
        // Önceki mumu closed olarak işaretle
        (lastCandle as { isClosed: boolean }).isClosed = true;
        this.candles.push(candle);

        // ── Max candles sınırını kontrol et ──
        if (this.candles.length > this.config.maxCandles) {
          this.candles.shift();
        }
      }
    } else {
      this.candles.push(candle);
    }

    return candle;
  }

  /**
   * Tüm mumları döner (PredatorSignalEngine için).
   */
  public getCandles(): Candle[] {
    return [...this.candles];
  }

  /**
   * Son N mumu döner.
   */
  public getRecentCandles(count: number): Candle[] {
    return this.candles.slice(-count);
  }

  /**
   * Son kapanmış mumu döner.
   */
  public getLastClosedCandle(): Candle | null {
    for (let i = this.candles.length - 1; i >= 0; i--) {
      if (this.candles[i].isClosed) return this.candles[i];
    }
    return null;
  }

  /**
   * Mevcut (kapanmamış) mumu döner.
   */
  public getCurrentCandle(): Candle | null {
    if (this.candles.length === 0) return null;
    const last = this.candles[this.candles.length - 1];
    return last.isClosed ? null : last;
  }

  /**
   * Mevcut sembol ve interval bilgisi.
   */
  public getSymbol(): string { return this.currentSymbol; }
  public getInterval(): string { return this.currentInterval; }

  /**
   * Interval'i saniye cinsinden döner.
   */
  public getIntervalSeconds(): number {
    const map: Record<string, number> = {
      "1m": 60, "3m": 180, "5m": 300, "15m": 900,
      "30m": 1800, "1h": 3600, "2h": 7200, "4h": 14400,
      "6h": 21600, "12h": 43200, "1d": 86400, "1w": 604800,
    };
    return map[this.currentInterval] ?? 60;
  }

  /**
   * Temizle (sembol değişiminde).
   */
  public reset(): void {
    this.candles = [];
    this.generationGuard++;
  }

  /**
   * Mum sayısı.
   */
  public get length(): number {
    return this.candles.length;
  }
}
