// Per-user authenticated WebSocket channel for live support-ticket updates
// (new tickets, chat messages, assignment/resolve, read receipts). Receive-only:
// clients send messages over REST (idempotent via clientMessageId) and listen here.
//
// Same shape as live-notifications-feed.ts — Redis pub/sub fan-in so any API
// instance can publish and the instance holding the socket delivers — except
// that auth accepts BOTH client types: the web admin dashboard (access_token
// cookie, JWT) and the mobile app (mobile_session_id cookie, MobileSession).

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

export const TICKETS_WS_PATH = '/ws/tickets'
const HEARTBEAT_MS = 30_000

function getCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

async function authenticateUpgrade(req: IncomingMessage): Promise<string | null> {
  const token = getCookie(req.headers.cookie, 'access_token')
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret) as JwtPayload
      return payload.type === 'access' ? payload.sub : null
    } catch {
      return null
    }
  }
  const sessionId = getCookie(req.headers.cookie, 'mobile_session_id')
  if (sessionId) {
    const ctx = await validateMobileSession(prisma, sessionId)
    return ctx?.userId ?? null
  }
  return null
}

/** Fire-and-forget: a failed push must never fail the REST request that caused it. */
export async function publishTicketEvent(event: LiveTicketEvent): Promise<void> {
  if (event.userIds.length === 0) return
  try {
    await redis.publish(TICKETS_PUBSUB_CHANNEL, JSON.stringify(event))
  } catch (err) {
    logger.error({ err, ticketId: event.ticketId, event: event.event }, 'publishTicketEvent: failed to publish')
  }
}

class LiveTicketsFeed {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>()
  private readonly alive = new WeakMap<WebSocket, boolean>()

  attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url !== TICKETS_WS_PATH) return

      void authenticateUpgrade(req).then(
        userId => {
          if (!userId) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
            socket.destroy()
            return
          }
          this.wss.handleUpgrade(req, socket, head, ws => {
            this.wss.emit('connection', ws, req)
            this.addConnection(userId, ws)
          })
        },
        (err: unknown) => {
          logger.error({ err }, 'LiveTicketsFeed: upgrade auth failed')
          socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n')
          socket.destroy()
        },
      )
    })

    // Mobile networks drop connections without a close frame — ping and reap.
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

  private addConnection(userId: string, ws: WebSocket): void {
    let set = this.connectionsByUser.get(userId)
    if (!set) {
      set = new Set()
      this.connectionsByUser.set(userId, set)
    }
    set.add(ws)
    this.alive.set(ws, true)
    ws.on('pong', () => this.alive.set(ws, true))

    ws.on('close', () => {
      const s = this.connectionsByUser.get(userId)
      if (!s) return
      s.delete(ws)
      if (s.size === 0) this.connectionsByUser.delete(userId)
    })
  }

  private sendToUser(userId: string, json: string): void {
    const sockets = this.connectionsByUser.get(userId)
    if (!sockets) return
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(json)
    }
  }
}

export const liveTicketsFeed = new LiveTicketsFeed()
