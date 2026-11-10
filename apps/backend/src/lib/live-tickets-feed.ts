// Per-user authenticated WebSocket channel for support tickets. It carries two things:
//
//  1. Live pushes — new tickets, chat messages, assignment/resolve, read receipts — fanned out
//     through Redis pub/sub so any API instance can publish and the instance holding the socket
//     delivers (same shape as live-notifications-feed.ts).
//  2. The chat itself. Both the mobile app (member) and the web dashboard (admin) send
//     message.send / history.get / ticket.read request frames here and get a correlated ack
//     (see modules/tickets/tickets.socket.ts). No chat goes over REST.
//
// 3. The admin sidebar badges. An admin's socket receives `{ event: 'badges.updated', notifications, tickets,
//    services }` once when it connects (so no REST call is needed for them) and again whenever one of the numbers may
//    have changed: a ticket or service event, a new or read notification, a change of the admin's access. The numbers
//    are computed per admin (some are shared, like "unassigned"; some are theirs, like "mine unread") and an admin's
//    other tabs and devices get the same push, so they stay in step.
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
import { BADGES_PUBSUB_CHANNEL, NOTIFICATIONS_PUBSUB_CHANNEL, TICKETS_PUBSUB_CHANNEL } from './queue.js'
import type { BadgesRefreshEvent, LiveNotificationEvent, LiveServiceEvent, LiveTicketEvent } from './queue.js'
import type { AdminBadges, BadgeViewer } from './admin-badges.js'
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
// A burst of events (a reply, its read receipt, its notification...) becomes one recompute and one push.
const BADGE_DEBOUNCE_MS = 300
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
async function publishLiveEvent(event: LiveTicketEvent | LiveServiceEvent): Promise<void> {
  if (event.userIds.length === 0) return
  try {
    await redis.publish(TICKETS_PUBSUB_CHANNEL, JSON.stringify(event))
  } catch (err) {
    const id = 'ticketId' in event ? { ticketId: event.ticketId } : { requestId: event.requestId }
    logger.error({ err, ...id, event: event.event }, 'publishLiveEvent: failed to publish')
  }
}

export const publishTicketEvent: (event: LiveTicketEvent) => Promise<void> = publishLiveEvent
export const publishServiceEvent: (event: LiveServiceEvent) => Promise<void> = publishLiveEvent

/** Counts the sidebar badges for one admin. Injected (like onFrame) so this module need not import the services. */
export type ComputeBadges = (viewer: BadgeViewer) => Promise<AdminBadges>

export interface AttachOptions {
  computeBadges?: ComputeBadges
  /** Listen for events on Redis. Only tests turn this off, to drive the feed directly. Default true. */
  subscribe?: boolean
}

class LiveTicketsFeed {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>()
  private readonly alive = new WeakMap<WebSocket, boolean>()
  private readonly authByWs = new WeakMap<WebSocket, ConnectionAuth>()
  // Pushes to one socket are verified asynchronously; chaining them keeps their order intact.
  private readonly pushChain = new WeakMap<WebSocket, Promise<void>>()
  private onFrame: TicketSocketHandler | null = null
  private computeBadges: ComputeBadges | null = null
  // One pending recompute per admin, and the last badges sent to them (an unchanged set is not sent again).
  private readonly badgeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly lastBadges = new Map<string, string>()

  /**
   * `onFrame` handles inbound request frames. It is injected (rather than imported) because the
   * tickets services import this module to publish events — a direct import would be circular.
   * `options.computeBadges` is injected for the same reason.
   */
  attach(httpServer: HttpServer, onFrame?: TicketSocketHandler, options: AttachOptions = {}): void {
    this.onFrame = onFrame ?? null
    this.computeBadges = options.computeBadges ?? null
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

    if (options.subscribe === false) return
    const subscriber = new Redis({
      host: env.redis.host,
      port: env.redis.port,
      password: env.redis.password || undefined,
      db: env.redis.db,
    })
    subscriber.on('error', (err: unknown) => logger.error({ err }, 'LiveTicketsFeed: redis subscriber error'))
    // Ticket and service events, plus the two signals that only move the sidebar badges.
    subscriber.subscribe(TICKETS_PUBSUB_CHANNEL, BADGES_PUBSUB_CHANNEL, NOTIFICATIONS_PUBSUB_CHANNEL).then(
      () => logger.info('LiveTicketsFeed: subscribed to redis channels'),
      (err: unknown) => logger.error({ err }, 'LiveTicketsFeed: failed to subscribe to redis channels'),
    )
    subscriber.on('message', (channel: string, raw: string) => {
      try {
        if (channel === BADGES_PUBSUB_CHANNEL) {
          this.refreshBadgesFor((JSON.parse(raw) as BadgesRefreshEvent).userIds)
        } else if (channel === NOTIFICATIONS_PUBSUB_CHANNEL) {
          // A new notification for someone moves their unread count; only admins with an open dashboard care.
          this.refreshBadgesFor([(JSON.parse(raw) as LiveNotificationEvent).userId])
        } else {
          const { userIds, ...payload } = JSON.parse(raw) as LiveTicketEvent | LiveServiceEvent
          const json = JSON.stringify(payload)
          for (const userId of userIds) this.sendToUser(userId, json)
          // Every ticket / service event can move "unassigned", "mine unread" or "needs review" for its audience.
          this.refreshBadgesFor(userIds)
        }
      } catch (err) {
        logger.error({ err }, 'LiveTicketsFeed: failed to parse pubsub message')
      }
    })
  }

  /** The open dashboard sockets (web, admin) of one user. */
  private adminSockets(userId: string): { ws: WebSocket; auth: Extract<ConnectionAuth, { kind: 'web' }> }[] {
    const out: { ws: WebSocket; auth: Extract<ConnectionAuth, { kind: 'web' }> }[] = []
    for (const ws of this.connectionsByUser.get(userId) ?? []) {
      const auth = this.authByWs.get(ws)
      if (auth && auth.kind === 'web' && auth.role === 'admin') out.push({ ws, auth })
    }
    return out
  }

  /**
   * Recomputes and pushes the sidebar badges of these admins (those with a dashboard open; anyone else is skipped
   * without a query). Calls close together are merged: one recompute, read after the last of them.
   */
  refreshBadgesFor(userIds: string[]): void {
    if (!this.computeBadges) return
    for (const userId of new Set(userIds)) {
      if (this.badgeTimers.has(userId) || this.adminSockets(userId).length === 0) continue
      this.badgeTimers.set(
        userId,
        setTimeout(() => {
          this.badgeTimers.delete(userId)
          void this.pushBadges(userId)
        }, BADGE_DEBOUNCE_MS),
      )
    }
  }

  private async badgesJson(auth: Extract<ConnectionAuth, { kind: 'web' }>): Promise<string | null> {
    if (!this.computeBadges) return null
    const badges = await this.computeBadges({ id: auth.userId, isSuperAdmin: auth.isSuperAdmin, accessibleCommunityIds: auth.accessibleCommunityIds })
    return JSON.stringify({ event: 'badges.updated', ...badges })
  }

  /** To all of one admin's sockets, so every tab and device shows the same numbers. Skipped when nothing changed. */
  private async pushBadges(userId: string): Promise<void> {
    try {
      const sockets = this.adminSockets(userId)
      const first = sockets[0]
      if (!first) return
      const json = await this.badgesJson(first.auth)
      if (!json || this.lastBadges.get(userId) === json) return
      this.lastBadges.set(userId, json)
      for (const { ws } of sockets) this.push(ws, json)
    } catch (err) {
      logger.warn({ err, userId }, 'LiveTicketsFeed: could not refresh sidebar badges')
    }
  }

  /** What a dashboard socket gets the moment it connects, so the sidebar never needs a REST call for its badges. */
  private async sendBadgeSnapshot(ws: WebSocket, auth: Extract<ConnectionAuth, { kind: 'web' }>): Promise<void> {
    try {
      const json = await this.badgesJson(auth)
      if (!json) return
      this.lastBadges.set(auth.userId, json)
      this.push(ws, json)
    } catch (err) {
      logger.warn({ err, userId: auth.userId }, 'LiveTicketsFeed: could not send the badge snapshot')
    }
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
    if (auth.kind === 'web' && auth.role === 'admin') void this.sendBadgeSnapshot(ws, auth)

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
      if (s.size === 0) {
        this.connectionsByUser.delete(userId)
        clearTimeout(this.badgeTimers.get(userId))
        this.badgeTimers.delete(userId)
        this.lastBadges.delete(userId)
      }
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
