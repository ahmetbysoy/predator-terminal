/**
 * PREDATOR TERMINAL - FAZ 4: User Alarm Manager
 * Global alarm sistemi - tüm semboller için alarm kontrolü
 */

type EventHandler<T = any> = (data: T) => void;

export interface Alarm {
  id: string;
  symbol: string;
  price: number;
  type: "above" | "below";
  createdAt: number;
  triggered: boolean;
}

export class UserAlarmManager {
  private alarms: Map<string, Alarm[]> = new Map();
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private nextId: number = 1;

  public addAlarm(symbol: string, price: number, type: "above" | "below"): string {
    const id = `alarm_${this.nextId++}`;
    const alarm: Alarm = {
      id,
      symbol: symbol.toUpperCase(),
      price,
      type,
      createdAt: Date.now(),
      triggered: false,
    };

    const symbolAlarms = this.alarms.get(alarm.symbol) || [];
    symbolAlarms.push(alarm);
    this.alarms.set(alarm.symbol, symbolAlarms);

    console.log(`[Alarm] Added: ${alarm.symbol} ${type} ${price}`);
    return id;
  }

  public removeAlarm(alarmId: string): boolean {
    for (const [symbol, alarms] of this.alarms.entries()) {
      const idx = alarms.findIndex(a => a.id === alarmId);
      if (idx !== -1) {
        alarms.splice(idx, 1);
        console.log(`[Alarm] Removed: ${alarmId}`);
        return true;
      }
    }
    return false;
  }

  public checkPrice(symbol: string, currentPrice: number): void {
    const symbolAlarms = this.alarms.get(symbol.toUpperCase());
    if (!symbolAlarms) return;

    for (const alarm of symbolAlarms) {
      if (alarm.triggered) continue;

      let shouldTrigger = false;
      
      if (alarm.type === "above" && currentPrice >= alarm.price) {
        shouldTrigger = true;
      } else if (alarm.type === "below" && currentPrice <= alarm.price) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        alarm.triggered = true;
        console.log(`[Alarm] TRIGGERED: ${alarm.symbol} ${alarm.type} ${alarm.price} (current: ${currentPrice})`);
        this.emit("triggered", alarm);
      }
    }
  }

  public checkAll(prices: Map<string, number>): void {
    for (const [symbol, price] of prices.entries()) {
      this.checkPrice(symbol, price);
    }
  }

  public getAlarms(symbol?: string): Alarm[] {
    if (symbol) {
      return this.alarms.get(symbol.toUpperCase()) || [];
    }
    
    const all: Alarm[] = [];
    for (const alarms of this.alarms.values()) {
      all.push(...alarms);
    }
    return all;
  }

  public getAlarmCount(): number {
    let count = 0;
    for (const alarms of this.alarms.values()) {
      count += alarms.filter(a => !a.triggered).length;
    }
    return count;
  }

  public clearTriggered(): void {
    for (const [symbol, alarms] of this.alarms.entries()) {
      const active = alarms.filter(a => !a.triggered);
      this.alarms.set(symbol, active);
    }
  }

  public on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  public off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[Alarm] Handler error for ${event}:`, err);
      }
    });
  }
}
