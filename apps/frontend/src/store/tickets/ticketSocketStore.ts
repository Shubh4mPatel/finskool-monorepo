import type { LiveTicketEvent } from "@/lib/tickets";

const WS_PATH = "/ws/tickets";
const MAX_RECONNECT_DELAY_MS = 30000;

type Listener = (event: LiveTicketEvent) => void;

// Mirrors notificationSocketStore: one shared socket per tab, auto-reconnect with backoff.
// Listeners are told when the socket (re)opens so they can refetch anything missed while offline.
class TicketSocketStore {
  private started = false;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private hasConnectedBefore = false;

  connect(): void {
    if (this.started) return;
    this.started = true;
    this.openSocket();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Fires after a *re*connect (not the first connect) — events may have been missed in the gap. */
  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => this.reconnectListeners.delete(listener);
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
      if (this.hasConnectedBefore) this.reconnectListeners.forEach((l) => l());
      this.hasConnectedBefore = true;
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as LiveTicketEvent;
        this.listeners.forEach((l) => l(data));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => this.scheduleReconnect();
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

export const ticketSocketStore = new TicketSocketStore();
