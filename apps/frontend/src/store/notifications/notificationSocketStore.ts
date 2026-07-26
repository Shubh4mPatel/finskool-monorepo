export interface LiveNotificationEvent {
  type: string;
  communityId: string;
  message: string;
  sourceId: string;
}

const WS_PATH = "/ws/notifications";
const MAX_RECONNECT_DELAY_MS = 30000;

type Listener = (event: LiveNotificationEvent) => void;

class NotificationSocketStore {
  private started = false;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();

  connect(): void {
    if (this.started) return;
    this.started = true;
    this.openSocket();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private wsUrl(): string {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    return apiUrl.replace(/^http/, "ws") + WS_PATH;
  }

  private openSocket(): void {
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as LiveNotificationEvent;
        this.listeners.forEach((l) => l(data));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = (e) => console.error("[notificationSocketStore] error", e);
    ws.onclose = (e) => {
      console.warn("[notificationSocketStore] closed", { code: e.code, reason: e.reason });
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

export const notificationSocketStore = new NotificationSocketStore();
