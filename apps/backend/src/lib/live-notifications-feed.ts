// Per-user authenticated WebSocket channel for live notification push. Unlike
// live-stock-feed.ts (broadcast-all, unauthenticated), each connection here is
// tied to a specific userId (from the access_token cookie) and only receives
// events addressed to that user.
//
// Notifications are created in the worker process (see worker.ts), not this
// one, so this feed can't just push directly — it subscribes to a Redis
// pub/sub channel that NotificationsService.fanOutCommunity publishes to,
// and forwards matching events to that user's open sockets.
//
// One socket for every notification, for both clients:
//  - web (access_token cookie): receives the raw event, exactly as before.
//  - mobile (mobile_session_id cookie): receives { event: 'notification.created', notification, unreadCount },
//    the full inbox item plus the new unread total, so the app can update its list and badge without
//    a refetch. The session is re-verified before every push, and a logged-out device is closed with
//    code 4401 (re-authenticate), the same contract as /ws/tickets.

import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveNotificationEvent } from './queue.js'
import type { JwtPayload } from '../middlewares/auth.middleware.js'
import prisma from './prisma.js'
import { validateMobileSession } from './mobile-session.js'
import { toNotificationItem } from '../modules/notifications/notifications.dto.js'
import { logger } from '../shared/logger.js'

export const NOTIFICATIONS_WS_PATH = '/ws/notifications'
const HEARTBEAT_MS = 30_000
// Custom close code: the client must log in again before reconnecting.
const WS_CLOSE_AUTH = 4401

type NotificationsAuth = { kind: 'web'; userId: string } | { kind: 'mobile'; userId: string; sessionId: string }

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

async function authenticateUpgrade(req: IncomingMessage): Promise<NotificationsAuth | null> {
  const token = getCookie(req.headers.cookie, 'access_token')
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret) as JwtPayload
      return payload.type === 'access' ? { kind: 'web', userId: payload.sub } : null
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

class LiveNotificationsFeed {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>()
  private readonly authByWs = new WeakMap<WebSocket, NotificationsAuth>()
  private readonly alive = new WeakMap<WebSocket, boolean>()
  // Mobile pushes are verified asynchronously; chaining them per socket keeps their order intact.
  private readonly pushChain = new WeakMap<WebSocket, Promise<void>>()

  attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url !== NOTIFICATIONS_WS_PATH) return

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
          logger.error({ err }, 'LiveNotificationsFeed: upgrade auth failed')
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
          socket.destroy()
        },
      )
    })

    // Mobile networks drop connections without a close frame: ping and reap dead sockets.
    setInterval(() => {
      for (const sockets of this.connectionsByUser.values()) {
        for (const ws of sockets) {
          if (this.alive.get(ws) === false) {
            ws.terminate()
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
    subscriber.on('error', (err: unknown) => logger.error({ err }, 'LiveNotificationsFeed: redis subscriber error'))
    subscriber.subscribe(NOTIFICATIONS_PUBSUB_CHANNEL).then(
      () => logger.info('LiveNotificationsFeed: subscribed to redis channel'),
      (err: unknown) => logger.error({ err }, 'LiveNotificationsFeed: failed to subscribe to redis channel'),
    )
    subscriber.on('message', (_channel: string, raw: string) => {
      try {
        const event = JSON.parse(raw) as LiveNotificationEvent
        this.sendToUser(event.userId, event)
      } catch (err) {
        logger.error({ err }, 'LiveNotificationsFeed: failed to parse pubsub message')
      }
    })
  }

  private addConnection(auth: NotificationsAuth, ws: WebSocket): void {
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
    ws.on('error', (err: unknown) => logger.warn({ err }, 'LiveNotificationsFeed: socket error'))

    ws.on('close', () => {
      const s = this.connectionsByUser.get(userId)
      if (!s) return
      s.delete(ws)
      if (s.size === 0) this.connectionsByUser.delete(userId)
    })
  }

  private sendToUser(userId: string, event: LiveNotificationEvent): void {
    const sockets = this.connectionsByUser.get(userId)
    if (!sockets || sockets.size === 0) return
    const webJson = JSON.stringify(event)
    for (const ws of sockets) {
      const auth = this.authByWs.get(ws)
      if (auth?.kind === 'mobile') this.pushToMobile(ws, auth, event)
      else if (ws.readyState === WebSocket.OPEN) ws.send(webJson)
    }
  }

  /** Sends the full inbox item and the new unread total, but only while the session is still valid. */
  private pushToMobile(ws: WebSocket, auth: Extract<NotificationsAuth, { kind: 'mobile' }>, event: LiveNotificationEvent): void {
    const next = (this.pushChain.get(ws) ?? Promise.resolve())
      .then(async () => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (!(await validateMobileSession(prisma, auth.sessionId))) {
          ws.close(WS_CLOSE_AUTH, 'reauthenticate')
          return
        }
        // The row exists before the event is published; the event only carries what is needed to find it.
        const [row, unreadCount] = await Promise.all([
          prisma.notification.findUnique({
            where: { uq_notifications_user_type_source: { userId: event.userId, type: event.type, sourceId: event.sourceId } },
          }),
          prisma.notification.count({ where: { userId: event.userId, isRead: false } }),
        ])
        if (!row || ws.readyState !== WebSocket.OPEN) return
        ws.send(JSON.stringify({ event: 'notification.created', notification: toNotificationItem(row), unreadCount }))
      })
      .catch((err: unknown) => logger.warn({ err }, 'LiveNotificationsFeed: mobile push failed'))
    this.pushChain.set(ws, next)
  }
}

export const liveNotificationsFeed = new LiveNotificationsFeed()
