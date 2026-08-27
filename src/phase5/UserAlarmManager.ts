/**
 * PREDATOR TERMINAL - FAZ 5: Enhanced UserAlarmManager
 * =======================================================
 * DÜZELTME #1 (FAZ 5): FAZ 3 + FAZ 4 birleştirildi.
 *
 * - localStorage persistence (MemoryStorageAdapter fallback)
 * - toggleAlarm() metodu
 * - checkAll() ile !ticker@arr çoklu sembol taraması
 * - Alarm tetiklendiğinde UI aksiyonları (toast, vibrate, notification)
 */

type EventHandler<T = any> = (data: T) => void;

export interface Alarm {
  id: string;
  symbol: string;
  price: number;
  type: "above" | "below";
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
  active: boolean;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * MemoryStorageAdapter: localStorage yoksa (Node.js/test ortamı) kullanılır.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  setItem(key: string, value: string): void { this.store.set(key, value); }
  removeItem(key: string): void { this.store.delete(key); }
}

export interface AlarmTriggerEvent {
  alarm: Alarm;
  currentPrice: number;
  timestamp: number;
}

export class UserAlarmManager {
  private alarms: Map<string, Alarm[]> = new Map();
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private nextId: number = 1;
  private storageKey: string;
  private storage: StorageAdapter;

  constructor(options?: { storageKey?: string; storage?: StorageAdapter }) {
    this.storageKey = options?.storageKey ?? "predatorAlarms";
    
    // ── DÜZELTME #1: localStorage persistence ──
    if (options?.storage) {
      this.storage = options.storage;
    } else if (typeof localStorage !== "undefined") {
      this.storage = localStorage as unknown as StorageAdapter;
    } else {
      this.storage = new MemoryStorageAdapter();
    }

    this.loadFromStorage();
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  public addAlarm(symbol: string, price: number, type: "above" | "below"): string {
    const id = `alarm_${this.nextId++}`;
    const alarm: Alarm = {
      id,
      symbol: symbol.toUpperCase(),
      price,
      type,
      createdAt: Date.now(),
      triggered: false,
      active: true,
    };

    const symbolAlarms = this.alarms.get(alarm.symbol) || [];
    symbolAlarms.push(alarm);
    this.alarms.set(alarm.symbol, symbolAlarms);

    this.saveToStorage();
    console.log(`[Alarm] Added: ${alarm.symbol} ${type} ${price}`);
    return id;
  }

  /**
   * DÜZELTME #1: toggleAlarm — alarmı aktif/pasif yap.
   */
  public toggleAlarm(alarmId: string): boolean {
    for (const [, alarms] of this.alarms.entries()) {
      const alarm = alarms.find(a => a.id === alarmId);
      if (alarm) {
        alarm.active = !alarm.active;
        this.saveToStorage();
        console.log(`[Alarm] Toggled: ${alarmId} → ${alarm.active ? "active" : "inactive"}`);
        return true;
      }
    }
    return false;
  }

  public removeAlarm(alarmId: string): boolean {
    for (const [symbol, alarms] of this.alarms.entries()) {
      const idx = alarms.findIndex(a => a.id === alarmId);
      if (idx !== -1) {
        alarms.splice(idx, 1);
        if (alarms.length === 0) this.alarms.delete(symbol);
        this.saveToStorage();
        console.log(`[Alarm] Removed: ${alarmId}`);
        return true;
      }
    }
    return false;
  }

  public checkPrice(symbol: string, currentPrice: number): AlarmTriggerEvent[] {
    const symbolAlarms = this.alarms.get(symbol.toUpperCase());
    if (!symbolAlarms) return [];

    const triggered: AlarmTriggerEvent[] = [];
    const now = Date.now();

    for (const alarm of symbolAlarms) {
      if (alarm.triggered || !alarm.active) continue;

      let shouldTrigger = false;
      if (alarm.type === "above" && currentPrice >= alarm.price) shouldTrigger = true;
      else if (alarm.type === "below" && currentPrice <= alarm.price) shouldTrigger = true;

      if (shouldTrigger) {
        alarm.triggered = true;
        alarm.triggeredAt = now;
        const event: AlarmTriggerEvent = { alarm, currentPrice, timestamp: now };
        triggered.push(event);
        
        console.log(`[Alarm] TRIGGERED: ${alarm.symbol} ${alarm.type} ${alarm.price} (current: ${currentPrice})`);
        this.emit("triggered", event);
        
        // ── DÜZELTME #7: UI Aksiyonları ──
        this.triggerUIActions(event);
      }
    }

    if (triggered.length > 0) {
      this.saveToStorage();
    }

    return triggered;
  }

  /**
   * DÜZELTME #2: !ticker@arr ile çoklu sembol taraması.
   * Binance ticker format: [{ s: "BTCUSDT", c: "67500.00", ... }, ...]
   */
  public checkAll(tickerData: Array<{ s: string; c: string }>): AlarmTriggerEvent[] {
    const allTriggered: AlarmTriggerEvent[] = [];

    for (const ticker of tickerData) {
      const symbol = ticker.s.toUpperCase();
      const price = parseFloat(ticker.c);

      if (!Number.isFinite(price)) continue;
      
      // ── Sadece alarmı olan sembolleri kontrol et (O(1) lookup) ──
      if (this.alarms.has(symbol)) {
        const triggered = this.checkPrice(symbol, price);
        allTriggered.push(...triggered);
      }
    }

    return allTriggered;
  }

  /**
   * Fiyat haritası ile de çalışabilir (Map format).
   */
  public checkAllFromMap(prices: Map<string, number>): AlarmTriggerEvent[] {
    const allTriggered: AlarmTriggerEvent[] = [];
    for (const [symbol, price] of prices.entries()) {
      if (this.alarms.has(symbol.toUpperCase())) {
        allTriggered.push(...this.checkPrice(symbol, price));
      }
    }
    return allTriggered;
  }

  public getAlarms(symbol?: string): Alarm[] {
    if (symbol) return [...(this.alarms.get(symbol.toUpperCase()) || [])];
    const all: Alarm[] = [];
    for (const alarms of this.alarms.values()) all.push(...alarms);
    return all;
  }

  public getActiveAlarms(symbol?: string): Alarm[] {
    return this.getAlarms(symbol).filter(a => a.active && !a.triggered);
  }

  public getAlarmCount(): number {
    let count = 0;
    for (const alarms of this.alarms.values()) {
      count += alarms.filter(a => !a.triggered && a.active).length;
    }
    return count;
  }

  public getSymbolsWithAlarms(): string[] {
    const symbols: string[] = [];
    for (const [symbol, alarms] of this.alarms.entries()) {
      if (alarms.some(a => !a.triggered && a.active)) symbols.push(symbol);
    }
    return symbols;
  }

  public clearTriggered(): void {
    for (const [symbol, alarms] of this.alarms.entries()) {
      const active = alarms.filter(a => !a.triggered);
      if (active.length > 0) this.alarms.set(symbol, active);
      else this.alarms.delete(symbol);
    }
    this.saveToStorage();
  }

  /**
   * Tüm alarmları JSON olarak dışa aktar (FAZ 5.3 export).
   */
  public toJSON(): string {
    const data: Record<string, Alarm[]> = {};
    for (const [symbol, alarms] of this.alarms.entries()) {
      data[symbol] = alarms;
    }
    return JSON.stringify({ version: 1, alarms: data, nextId: this.nextId });
  }

  /**
   * JSON'dan alarmları içe aktar.
   */
  public fromJSON(json: string): void {
    try {
      const parsed = JSON.parse(json);
      if (parsed.version !== 1) throw new Error("Unknown alarm schema version");
      
      this.alarms.clear();
      for (const [symbol, alarms] of Object.entries(parsed.alarms as Record<string, Alarm[]>)) {
        this.alarms.set(symbol, alarms);
      }
      this.nextId = parsed.nextId ?? 1;
      this.saveToStorage();
    } catch (err) {
      console.error("[Alarm] Failed to import:", err);
    }
  }

  // ─────────────────────────────────────────────
  // EVENT SYSTEM
  // ─────────────────────────────────────────────

  public on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  public off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  // ─────────────────────────────────────────────
  // PRIVATE: PERSISTENCE
  // ─────────────────────────────────────────────

  private saveToStorage(): void {
    try {
      this.storage.setItem(this.storageKey, this.toJSON());
    } catch (err) {
      console.error("[Alarm] Failed to save:", err);
    }
  }

  private loadFromStorage(): void {
    try {
      const json = this.storage.getItem(this.storageKey);
      if (json) this.fromJSON(json);
    } catch (err) {
      console.error("[Alarm] Failed to load:", err);
    }
  }

  // ─────────────────────────────────────────────
  // DÜZELTME #7: UI AKSİYONLARI
  // ─────────────────────────────────────────────

  private triggerUIActions(event: AlarmTriggerEvent): void {
    const { alarm, currentPrice } = event;
    const direction = alarm.type === "above" ? "▲" : "▼";
    const message = `🚨 ALARM: ${alarm.symbol} ${direction} ${alarm.price} (şu an: ${currentPrice})`;

    // ── Toast notification ──
    this.emit("toast", { message, type: "alarm", alarm });

    // ── Browser Notification API ──
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("Predator Terminal", { body: message, tag: alarm.id });
      } catch {
        // Notification constructor may fail in some environments
      }
    }

    // ── Vibration API (mobil) ──
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {
        // Vibration may not be available
      }
    }
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(handler => {
      try { handler(data); } catch (err) {
        console.error(`[Alarm] Handler error for ${event}:`, err);
      }
    });
  }
}
