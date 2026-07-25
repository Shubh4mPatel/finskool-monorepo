import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { generateSync } from 'otplib'
import type { SnapQuoteTick, TokenSubscription } from './angelone.types.js'
import { ANGELONE_CONFIG, MODE } from './angelone.config.js'
import { parsePacket } from './angelone.parser.js'
import { logger } from '../../shared/logger.js'

const BASE_URL = 'https://apiconnect.angelone.in'
const WS_URL = 'wss://smartapisocket.angelone.in/smart-stream'

const LOGIN_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-UserType': 'USER',
  'X-SourceID': 'WEB',
  'X-ClientLocalIP': '127.0.0.1',
  'X-ClientPublicIP': '127.0.0.1',
  'X-MACAddress': '00:00:00:00:00:00',
} as const

export interface AngelOneAuthEvent {
  jwtToken: string
  apiKey: string
}

// Declaration merging: typed overloads for EventEmitter.on / emit
export declare interface AngelOneClient {
  on(event: 'tick', listener: (tick: SnapQuoteTick) => void): this
  on(event: 'auth', listener: (auth: AngelOneAuthEvent) => void): this
  emit(event: 'tick', tick: SnapQuoteTick): boolean
  emit(event: 'auth', auth: AngelOneAuthEvent): boolean
}

export class AngelOneClient extends EventEmitter {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private destroyed = false
  private currentJwtToken: string | null = null

  // All active subscriptions — replayed on every reconnect. Populated purely
  // via `subscribe()` (no fixed startup list — we only ever care about
  // tokens tied to actual stock recommendations, decided by live-stock-feed.ts).
  private activeSubscriptions: TokenSubscription[] = []

  connect(): void {
    void this.start()
  }

  destroy(): void {
    this.destroyed = true
    this.cleanup()
  }

  /** Current JWT token, or null if not yet authenticated. */
  getJwtToken(): string | null {
    return this.currentJwtToken
  }

  /**
   * Subscribe additional token lists to the live WebSocket feed.
   * Merges into activeSubscriptions so they are replayed on reconnect.
   */
  subscribe(tokenList: TokenSubscription[]): void {
    for (const incoming of tokenList) {
      const existing = this.activeSubscriptions.find(
        s => s.exchangeType === incoming.exchangeType,
      )
      if (existing) {
        const set = new Set(existing.tokens)
        for (const t of incoming.tokens) set.add(t)
        existing.tokens = Array.from(set)
      } else {
        this.activeSubscriptions.push({ ...incoming, tokens: [...incoming.tokens] })
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        correlationID: 'finskool_dynamic',
        action: 1,
        params: { mode: MODE, tokenList },
      }))
    }
    // If socket is not open the merged activeSubscriptions will be sent on next connect
  }

  private async start(): Promise<void> {
    if (this.destroyed) return
    try {
      const { jwtToken, feedToken } = await this.login()
      this.currentJwtToken = jwtToken
      this.emit('auth', { jwtToken, apiKey: ANGELONE_CONFIG.apiKey })
      this.openSocket(jwtToken, feedToken)
    } catch (err) {
      logger.error({ err }, 'AngelOne login failed, retrying in 10s')
      setTimeout(() => void this.start(), 10_000)
    }
  }

  private async login(): Promise<{ jwtToken: string; feedToken: string }> {
    const totp = generateSync({ secret: ANGELONE_CONFIG.totpSecret })

    const res = await fetch(`${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`, {
      method: 'POST',
      headers: { ...LOGIN_HEADERS, 'X-PrivateKey': ANGELONE_CONFIG.apiKey },
      body: JSON.stringify({
        clientcode: ANGELONE_CONFIG.clientCode,
        password: ANGELONE_CONFIG.pin,
        totp,
      }),
    })

    const data = (await res.json()) as {
      status: boolean
      message: string
      errorcode: string
      data: { jwtToken: string; feedToken: string; clientcode: string }
    }

    if (!data.status) {
      throw new Error(`Login failed: ${data.message} (${data.errorcode})`)
    }

    logger.info({ clientCode: ANGELONE_CONFIG.clientCode }, 'AngelOne login successful')
    return { jwtToken: data.data.jwtToken, feedToken: data.data.feedToken }
  }

  private openSocket(jwtToken: string, feedToken: string): void {
    const ws = new WebSocket(WS_URL, {
      headers: {
        Authorization: jwtToken,
        'x-api-key': ANGELONE_CONFIG.apiKey,
        'x-client-code': ANGELONE_CONFIG.clientCode,
        'x-feed-token': feedToken,
      },
    })
    this.ws = ws

    ws.on('open', () => {
      logger.info('AngelOne WebSocket connected')

      // Subscribe all active tokens (initial + dynamically added)
      if (this.activeSubscriptions.length > 0) {
        ws.send(JSON.stringify({
          correlationID: 'finskool0001',
          action: 1,
          params: { mode: MODE, tokenList: this.activeSubscriptions },
        }))
      }

      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 30_000)
    })

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary) {
        const text = raw.toString()
        if (text !== 'pong') logger.warn({ message: text }, 'AngelOne WS text message')
        return
      }

      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
      const tick = parsePacket(buf)
      if (tick) this.emit('tick', tick)
    })

    ws.on('error', (err) => {
      logger.error({ err }, 'AngelOne WS error')
    })

    ws.on('close', (code, reason) => {
      this.cleanup()
      if (!this.destroyed) {
        logger.warn({ code, reason: reason.toString() }, 'AngelOne WS closed, reconnecting in 5s')
        setTimeout(() => void this.start(), 5_000)
      }
    })
  }

  private cleanup(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.ws !== null) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }
  }
}
