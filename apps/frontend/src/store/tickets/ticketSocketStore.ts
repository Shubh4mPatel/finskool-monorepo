import { refreshSession } from "@/lib/api";
import { randomId } from "@/lib/tickets";
import type { LiveTicketEvent } from "@/lib/tickets";

const WS_PATH = "/ws/tickets";
const MAX_RECONNECT_DELAY_MS = 30000;
const OPEN_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;
// Server asks us to re-authenticate (token expired / session ended) by closing with this code.
const WS_CLOSE_AUTH = 4401;

type Listener = (event: LiveTicketEvent) => void;

/** A failed chat request: either the server's error ack (code/message) or a transport problem. */
export class TicketSocketError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly errors?: unknown,
  ) {
    super(message);
    this.name = "TicketSocketError";
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AckFrame {
  event: "ack";
  id: string | null;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; errors?: unknown };
}

// One shared /ws/tickets socket per tab. It carries live pushes AND the chat itself: request()
// sends { id, action, payload } and resolves with the correlated ack. Chat never goes over REST.
class TicketSocketStore {
  private started = false;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private reconnectListeners = new Set<() => void>();
  private openWaiters = new Set<() => void>();
  private pending = new Map<string, Pending>();
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

  /**
   * Sends a chat request and resolves with the server's `data`. Rejects with TicketSocketError.
   * If the session expired or the connection dropped mid-request, it re-authenticates, reconnects and
   * retries once — safe because message.send carries a clientMessageId (the server dedupes) and
   * history.get / ticket.read are idempotent.
   */
  async request<T>(action: "message.send" | "history.get" | "ticket.read", payload: unknown): Promise<T> {
    try {
      return await this.requestOnce<T>(action, payload);
    } catch (err) {
      if (err instanceof TicketSocketError && (err.code === "AUTH_EXPIRED" || err.code === "CONNECTION_LOST")) {
        await this.reauthenticate();
        return this.requestOnce<T>(action, payload);
      }
      throw err;
    }
  }

  private async requestOnce<T>(action: string, payload: unknown): Promise<T> {
    const ws = await this.whenOpen();
    const id = randomId();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TicketSocketError("TIMEOUT", "The server took too long to respond. Please try again."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      ws.send(JSON.stringify({ id, action, payload }));
    });
  }

  private whenOpen(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    this.connect();
    return new Promise<WebSocket>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.openWaiters.delete(done);
        if (this.ws?.readyState === WebSocket.OPEN) resolve(this.ws);
        else reject(new TicketSocketError("NOT_CONNECTED", "Couldn't reach the chat server. Check your connection and try again."));
      };
      const timer = setTimeout(done, OPEN_TIMEOUT_MS);
      this.openWaiters.add(done);
    });
  }

  /** Refresh the session cookie, then bring up a fresh socket without waiting out the backoff. */
  private async reauthenticate(): Promise<void> {
    await refreshSession().catch(() => false);
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) this.ws.close();
    this.ws = null;
    this.openSocket();
  }

  private wsUrl(): string {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    return apiUrl.replace(/^http/, "ws") + WS_PATH;
  }

  private failAllPending(error: TicketSocketError): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
      this.pending.delete(id);
    }
  }

  private openSocket(): void {
    const ws = new WebSocket(this.wsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      if (this.hasConnectedBefore) this.reconnectListeners.forEach((l) => l());
      this.hasConnectedBefore = true;
      [...this.openWaiters].forEach((w) => w());
    };

    ws.onmessage = (event: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return; // ignore malformed messages
      }
      if ((data as { event?: string }).event === "ack") {
        const ack = data as AckFrame;
        const p = ack.id ? this.pending.get(ack.id) : undefined;
        if (!p || !ack.id) return;
        clearTimeout(p.timer);
        this.pending.delete(ack.id);
        if (ack.ok) p.resolve(ack.data);
        else p.reject(new TicketSocketError(ack.error?.code ?? "ERROR", ack.error?.message ?? "Request failed", ack.error?.errors));
        return;
      }
      this.listeners.forEach((l) => l(data as LiveTicketEvent));
    };

    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return; // a newer socket already replaced this one
      this.ws = null;
      // Requests still waiting for an ack will never get one on this socket.
      this.failAllPending(new TicketSocketError("CONNECTION_LOST", "Connection lost. Please try again."));
      [...this.openWaiters].forEach((w) => w());
      if (e.code === WS_CLOSE_AUTH) {
        // Token expired / session ended: refresh first, otherwise the reconnect would be refused with a 401.
        void refreshSession()
          .catch(() => false)
          .finally(() => this.scheduleReconnect(0));
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(delayOverride?: number): void {
    if (this.reconnectTimer) return;
    const delay = delayOverride ?? Math.min(1000 * 2 ** this.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    if (delayOverride === undefined) this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }
}

export const ticketSocketStore = new TicketSocketStore();
