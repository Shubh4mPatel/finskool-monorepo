export interface StockTick {
  symbol: string;
  ltp: number;
  change: number;
  changePercent: number;
  timestamp: string;
}

export interface MarketStatus {
  open: boolean | null;
  timestamp: string | null;
}

const WS_PATH = "/ws/stock-prices";
const MAX_RECONNECT_DELAY_MS = 30000;

type Listener = () => void;

class LiveStockPricesStore {
  private started = false;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private ticks: Record<string, StockTick> = {};
  private ticksListeners = new Set<Listener>();

  private marketStatus: MarketStatus = { open: null, timestamp: null };
  private marketStatusListeners = new Set<Listener>();

  connect(): void {
    if (this.started) return;
    this.started = true;
    this.openSocket();
  }

  subscribeTicks(listener: Listener): () => void {
    this.ticksListeners.add(listener);
    return () => this.ticksListeners.delete(listener);
  }

  getTicksSnapshot(): Record<string, StockTick> {
    return this.ticks;
  }

  subscribeMarketStatus(listener: Listener): () => void {
    this.marketStatusListeners.add(listener);
    return () => this.marketStatusListeners.delete(listener);
  }

  getMarketStatusSnapshot(): MarketStatus {
    return this.marketStatus;
  }

  private wsUrl(): string {
    return (process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3010") + WS_PATH;
  }

  private openSocket(): void {
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;

        if (msg["type"] === "market_status") {
          this.marketStatus = {
            open: typeof msg["marketOpen"] === "boolean" ? (msg["marketOpen"] as boolean) : this.marketStatus.open,
            timestamp: typeof msg["timestamp"] === "string" ? (msg["timestamp"] as string) : this.marketStatus.timestamp,
          };
          this.marketStatusListeners.forEach((l) => l());
          return;
        }

        const data = msg["data"] as StockTick | undefined;
        if (msg["type"] === "tick" && data?.symbol) {
          this.ticks = { ...this.ticks, [data.symbol]: data };
          this.ticksListeners.forEach((l) => l());
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = (e) => console.error("[liveStockPricesStore] error", e);
    ws.onclose = (e) => {
      console.warn("[liveStockPricesStore] closed", { code: e.code, reason: e.reason });
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.ws = null;
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}

export const liveStockPricesStore = new LiveStockPricesStore();
