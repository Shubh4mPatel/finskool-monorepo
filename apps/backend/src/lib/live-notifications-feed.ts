// Per-user authenticated WebSocket channel for live notification push. Unlike
// live-stock-feed.ts (broadcast-all, unauthenticated), each connection here is
// tied to a specific userId (from the access_token cookie) and only receives
// events addressed to that user.
//
// Notifications are created in the worker process (see worker.ts), not this
// one, so this feed can't just push directly — it subscribes to a Redis
// pub/sub channel that NotificationsService.fanOutCommunity publishes to,
// and forwards matching events to that user's open sockets.

import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import jwt from 'jsonwebtoken'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveNotificationEvent } from './queue.js'
import type { JwtPayload } from '../middlewares/auth.middleware.js'
import { logger } from '../shared/logger.js'

export const NOTIFICATIONS_WS_PATH = '/ws/notifications'

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

function authenticateUpgrade(req: IncomingMessage): string | null {
  const token = getCookie(req.headers.cookie, 'access_token')
  if (!token) return null
  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload
    return payload.type === 'access' ? payload.sub : null
  } catch {
    return null
  }
}

class LiveNotificationsFeed {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>()

  attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url !== NOTIFICATIONS_WS_PATH) return

      const userId = authenticateUpgrade(req)
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }

      this.wss.handleUpgrade(req, socket, head, ws => {
        this.wss.emit('connection', ws, req)
        this.addConnection(userId, ws)
      })
    })

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

  private addConnection(userId: string, ws: WebSocket): void {
    let set = this.connectionsByUser.get(userId)
    if (!set) {
      set = new Set()
      this.connectionsByUser.set(userId, set)
    }
    set.add(ws)

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
    const json = JSON.stringify(event)
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json)
    }
  }
}

export const liveNotificationsFeed = new LiveNotificationsFeed()
