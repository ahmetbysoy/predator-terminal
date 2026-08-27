/**
 * PREDATOR TERMINAL - FAZ 4: Stream Multiplexer
 * Tek WebSocket bağlantısında çoklu stream yönetimi
 */

type EventHandler<T = any> = (data: T) => void;

export class StreamMultiplexer {
  private wsBaseUrl: string;
  private ws: WebSocket | null = null;
  private currentSymbol: string = "";
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private handlers: Map<string, Set<EventHandler>> = new Map();

  constructor(wsBaseUrl: string) {
    this.wsBaseUrl = wsBaseUrl;
  }

  public connect(symbol: string): void {
    this.currentSymbol = symbol;
    this.doConnect();
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public switchSymbol(symbol: string): void {
    this.disconnect();
    this.currentSymbol = symbol;
    this.doConnect();
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

  private doConnect(): void {
    const streams = [
      `${this.currentSymbol.toLowerCase()}@depth@100ms`,
      `${this.currentSymbol.toLowerCase()}@aggTrade`,
      `${this.currentSymbol.toLowerCase()}@kline_1m`,
      "!ticker@arr", // DÜZELTME #2 (FAZ 5): Global çoklu sembol fiyat taraması
    ];
    
    const url = `${this.wsBaseUrl}/stream?streams=${streams.join("/")}`;
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.onopen = () => {
        console.log(`[StreamMux] Connected: ${this.currentSymbol}`);
        this.reconnectAttempts = 0;
        this.emit("connected", {});
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.routeMessage(msg);
        } catch (err) {
          console.error("[StreamMux] Parse error:", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[StreamMux] Disconnected");
        this.emit("disconnected", {});
        this.attemptReconnect();
      };

      this.ws.onerror = (err) => {
        console.error("[StreamMux] WebSocket error:", err);
        this.emit("error", new Error("WebSocket error"));
      };
    } catch (err) {
      console.error("[StreamMux] Connection failed:", err);
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.attemptReconnect();
    }
  }

  private routeMessage(msg: any): void {
    if (!msg.stream || !msg.data) return;

    const stream = msg.stream as string;
    const data = msg.data;

    if (stream.includes("@depth")) {
      this.emit("depth", data);
    } else if (stream.includes("@aggTrade")) {
      this.emit("aggTrade", data);
    } else if (stream.includes("@kline")) {
      this.emit("kline", data);
    } else if (stream.includes("!ticker@arr")) {
      // DÜZELTME #2: Global ticker → UserAlarmManager.checkAll()
      this.emit("ticker", data);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[StreamMux] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`[StreamMux] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (this.currentSymbol) {
        this.doConnect();
      }
    }, delay);
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[StreamMux] Handler error for ${event}:`, err);
      }
    });
  }
}
