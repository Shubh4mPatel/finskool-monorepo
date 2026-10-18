// Per-user authenticated WebSocket channel for support tickets. It carries two things:
//
//  1. Live pushes — new tickets, chat messages, assignment/resolve, read receipts — fanned out
//     through Redis pub/sub so any API instance can publish and the instance holding the socket
//     delivers (same shape as live-notifications-feed.ts).
//  2. The chat itself. Both the mobile app (member) and the web dashboard (admin) send
//     message.send / history.get / ticket.read request frames here and get a correlated ack
//     (see modules/tickets/tickets.socket.ts). No chat goes over REST.
//
// Auth accepts both client types: the web dashboard (access_token cookie, JWT) and the mobile
// app (mobile_session_id cookie, MobileSession). The upgrade authenticates once, but a socket can
// live for hours, so every request frame is re-verified (session still valid / token not expired)
// — the same guarantee REST gave per request.

import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import prisma from './prisma.js'
import redis from './redis.js'
import { TICKETS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveTicketEvent } from './queue.js'
import { validateMobileSession } from './mobile-session.js'
import type { JwtPayload } from '../middlewares/auth.middleware.js'
import { logger } from '../shared/logger.js'
import type { SocketPrincipal, TicketAck, TicketSocketHandler } from '../modules/tickets/tickets.socket.js'

export const TICKETS_WS_PATH = '/ws/tickets'
const HEARTBEAT_MS = 30_000
// A message is ≤ 2000 chars + 5 attachment refs; anything bigger is not a legitimate frame.
const MAX_FRAME_BYTES = 64 * 1024
// Per-connection flood guard for inbound request frames.
const RATE_WINDOW_MS = 10_000
const RATE_MAX_FRAMES = 30
// Custom close code: the client must re-authenticate (refresh its session) before reconnecting.
export const WS_CLOSE_AUTH = 4401

/** What the upgrade learned about the connection; re-verified per request frame. */
type ConnectionAuth =
  | { kind: 'mobile'; userId: string; sessionId: string }
  | {
      kind: 'web'
      userId: string
      role: string
      isSuperAdmin: boolean
      // null = unrestricted (super admin), same convention as the JWT claim
      accessibleCommunityIds: string[] | null
      expiresAtMs: number
    }

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

async function authenticateUpgrade(req: IncomingMessage): Promise<ConnectionAuth | null> {
  const token = getCookie(req.headers.cookie, 'access_token')
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret) as JwtPayload & { exp?: number }
      if (payload.type !== 'access') return null
      return {
        kind: 'web',
        userId: payload.sub,
        role: payload.role,
        isSuperAdmin: payload.isSuperAdmin ?? false,
        // undefined (claim missing on an old token) must NOT become "unrestricted" — only null is.
        accessibleCommunityIds: payload.accessibleCommunityIds === undefined ? [] : payload.accessibleCommunityIds,
        expiresAtMs: (payload.exp ?? 0) * 1000,
      }
    } catch {
      return null
    }
  }
  const sessionId = getCookie(req.headers.cookie, 'mobile_session_id')
  if (sessionId) {
    const ctx = await validateMobileSession(prisma, sessionId)
    return ctx ? { kind: 'mobile', userId: ctx.userId, sessionId } : null
  }
  return null
}

/** Re-verifies the connection for one request frame. A failure carries the ack to send (and closes the socket if the client must re-authenticate). */
async function resolvePrincipal(
  auth: ConnectionAuth,
): Promise<{ principal: SocketPrincipal } | { error: TicketAck; closeForAuth: boolean }> {
  if (auth.kind === 'mobile') {
    const ctx = await validateMobileSession(prisma, auth.sessionId)
    if (!ctx) return { error: ackError(null, 'AUTH_INVALID', 'Session ended. Please log in again.'), closeForAuth: true }
    return { principal: { kind: 'member', userId: ctx.userId } }
  }
  if (Date.now() >= auth.expiresAtMs) {
    return { error: ackError(null, 'AUTH_EXPIRED', 'Session expired. Reconnect to continue.'), closeForAuth: true }
  }
  if (auth.role !== 'admin') {
    return { error: ackError(null, 'FORBIDDEN', 'Chat from the web dashboard is for admins'), closeForAuth: false }
  }
  return {
    principal: {
      kind: 'admin',
      actor: { id: auth.userId, isSuperAdmin: auth.isSuperAdmin, accessibleCommunityIds: auth.accessibleCommunityIds },
    },
  }
}

function ackError(id: string | null, code: string, message: string): TicketAck {
  return { event: 'ack', id, ok: false, error: { code, message } }
}

function isWebExpired(auth: ConnectionAuth): boolean {
  return auth.kind === 'web' && Date.now() >= auth.expiresAtMs
}

/**
 * Whether the connection's credentials are still good, checked before a live push. The upgrade
 * authenticates once, so without this a logged-out member or an admin whose token expired would
 * keep receiving ticket messages (and attachment links) until they next sent a frame.
 */
async function stillAuthenticated(auth: ConnectionAuth): Promise<boolean> {
  if (auth.kind === 'web') return !isWebExpired(auth)
  return (await validateMobileSession(prisma, auth.sessionId)) !== null
}

/** Fire-and-forget: a failed push must never fail the request that caused it. */
export async function publishTicketEvent(event: LiveTicketEvent): Promise<void> {
  if (event.userIds.length === 0) return
  try {
    await redis.publish(TICKETS_PUBSUB_CHANNEL, JSON.stringify(event))
  } catch (err) {
    logger.error({ err, ticketId: event.ticketId, event: event.event }, 'publishTicketEvent: failed to publish')
  }
}

class LiveTicketsFeed {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>()
  private readonly alive = new WeakMap<WebSocket, boolean>()
  private readonly authByWs = new WeakMap<WebSocket, ConnectionAuth>()
  // Pushes to one socket are verified asynchronously; chaining them keeps their order intact.
  private readonly pushChain = new WeakMap<WebSocket, Promise<void>>()
  private onFrame: TicketSocketHandler | null = null

  /**
   * `onFrame` handles inbound request frames. It is injected (rather than imported) because the
   * tickets services import this module to publish events — a direct import would be circular.
   */
  attach(httpServer: HttpServer, onFrame?: TicketSocketHandler): void {
    this.onFrame = onFrame ?? null
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url !== TICKETS_WS_PATH) return

      void authenticateUpgrade(req).then(
        auth => {
          if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
          }
          this.wss.handleUpgrade(req, socket, head, ws => {
            this.wss.emit('connection', ws, req)
            this.addConnection(auth, ws)
          })
        },
        (err: unknown) => {
          logger.error({ err }, 'LiveTicketsFeed: upgrade auth failed')
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
          socket.destroy()
        },
      )
    })

    // Mobile networks drop connections without a close frame — ping and reap. A web socket whose
    // access token has expired is also closed here, so an idle one doesn't outlive its login.
    setInterval(() => {
      for (const sockets of this.connectionsByUser.values()) {
        for (const ws of sockets) {
          if (this.alive.get(ws) === false) {
            ws.terminate()
            continue
          }
          const auth = this.authByWs.get(ws)
          if (auth && isWebExpired(auth)) {
            ws.close(WS_CLOSE_AUTH, 'reauthenticate')
            continue
          }
          this.alive.set(ws, false)
          ws.ping()
        }
      }
    }, HEARTBEAT_MS).unref()

    const subscriber = new Redis({
      host: env.redis.host,
      port: env.redis.port,
      password: env.redis.password || undefined,
      db: env.redis.db,
    })
    subscriber.on('error', (err: unknown) => logger.error({ err }, 'LiveTicketsFeed: redis subscriber error'))
    subscriber.subscribe(TICKETS_PUBSUB_CHANNEL).then(
      () => logger.info('LiveTicketsFeed: subscribed to redis channel'),
      (err: unknown) => logger.error({ err }, 'LiveTicketsFeed: failed to subscribe to redis channel'),
    )
    subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const { userIds, ...payload } = JSON.parse(raw) as LiveTicketEvent
        const json = JSON.stringify(payload)
        for (const userId of userIds) this.sendToUser(userId, json)
      } catch (err) {
        logger.error({ err }, 'LiveTicketsFeed: failed to parse pubsub message')
      }
    })
  }

  private addConnection(auth: ConnectionAuth, ws: WebSocket): void {
    const { userId } = auth
    let set = this.connectionsByUser.get(userId)
    if (!set) {
      set = new Set()
      this.connectionsByUser.set(userId, set)
    }
    set.add(ws)
    this.authByWs.set(ws, auth)
    this.alive.set(ws, true)
    ws.on('pong', () => this.alive.set(ws, true))
    ws.on('error', (err: unknown) => logger.warn({ err }, 'LiveTicketsFeed: socket error'))

    let windowStart = Date.now()
    let framesInWindow = 0
    // Frames from one connection are handled strictly in arrival order, so two quick sends are
    // saved in the order the user typed them. The flood guard runs on arrival (before queuing),
    // so a spammer is rejected immediately instead of waiting behind their own backlog.
    let queue: Promise<void> = Promise.resolve()

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) return this.reply(ws, ackError(null, 'INVALID_FRAME', 'Send JSON text frames'))
      if (!this.onFrame) return this.reply(ws, ackError(null, 'NOT_SUPPORTED', 'This connection is receive-only'))

      const now = Date.now()
      if (now - windowStart > RATE_WINDOW_MS) {
        windowStart = now
        framesInWindow = 0
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(data.toString('utf8'))
      } catch {
        return this.reply(ws, ackError(null, 'INVALID_FRAME', 'Frame is not valid JSON'))
      }
      let id: string | null = null
      if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { id?: unknown }).id === 'string') {
        id = (parsed as { id: string }).id.slice(0, 64)
      }
      if (++framesInWindow > RATE_MAX_FRAMES) {
        return this.reply(ws, ackError(id, 'RATE_LIMITED', 'Too many requests, slow down'))
      }

      queue = queue.then(async () => {
        try {
          const resolved = await resolvePrincipal(auth)
          if ('error' in resolved) {
            this.reply(ws, { ...resolved.error, id })
            if (resolved.closeForAuth) ws.close(WS_CLOSE_AUTH, 'reauthenticate')
            return
          }
          this.reply(ws, await this.onFrame!(resolved.principal, parsed))
        } catch (err) {
          logger.error({ err }, 'LiveTicketsFeed: inbound frame failed')
          this.reply(ws, ackError(id, 'INTERNAL_ERROR', 'Internal server error'))
        }
      })
    })

    ws.on('close', () => {
      const s = this.connectionsByUser.get(userId)
      if (!s) return
      s.delete(ws)
      if (s.size === 0) this.connectionsByUser.delete(userId)
    })
  }

  private reply(ws: WebSocket, ack: TicketAck): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack))
  }

  private sendToUser(userId: string, json: string): void {
    const sockets = this.connectionsByUser.get(userId)
    if (!sockets) return
    for (const ws of sockets) this.push(ws, json)
  }

  /** Delivers one live event to one socket, but only if its credentials are still valid. */
  private push(ws: WebSocket, json: string): void {
    const next = (this.pushChain.get(ws) ?? Promise.resolve())
      .then(async () => {
        if (ws.readyState !== WebSocket.OPEN) return
        const auth = this.authByWs.get(ws)
        if (!auth) return
        if (!(await stillAuthenticated(auth))) {
          ws.close(WS_CLOSE_AUTH, 'reauthenticate')
          return
        }
        if (ws.readyState === WebSocket.OPEN) ws.send(json)
      })
      .catch((err: unknown) => logger.warn({ err }, 'LiveTicketsFeed: push failed'))
    this.pushChain.set(ws, next)
  }
}

export const liveTicketsFeed = new LiveTicketsFeed()
