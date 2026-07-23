// Wires AngelOne ticks into: (1) `Stock.cmp` in Postgres (throttled writes,
// so the REST recommendations API always reflects a near-live price even for
// a client with no active WebSocket connection), and (2) a broadcast-all
// `/ws/stock-prices` WebSocket for the frontend to overlay live updates
// without refetching.
//
// Deliberately simpler than porting EqLion's stocks-feed module verbatim:
// - No scrip-master resolver — our own `stocks` table already has `token`/
//   `exchange` for every stock, populated by the bulk import.
// - No per-client subscribe/unsubscribe protocol — we only ever care about
//   tokens tied to actual (non-deleted) stock recommendations, a small,
//   server-known set, so every connected client just gets every tick for
//   that set (broadcast-all).
// - No indices/gainers/losers sockets — nothing in finskool's UI consumes them.

import type { IncomingMessage, Server as HttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { PrismaClient } from '../generated/prisma/client.js'
import type { AngelOneClient } from '../sockets/angelone/angelone.client.js'
import type { TokenSubscription } from '../sockets/angelone/angelone.types.js'
import { EXCHANGE_TYPE } from '../sockets/angelone/angelone.config.js'
import { marketStatus } from '../sockets/angelone/market-status.js'
import { logger } from '../shared/logger.js'

export const STOCK_PRICES_WS_PATH = '/ws/stock-prices'

const DB_WRITE_THROTTLE_MS = 5_000 // at most one Stock.cmp write per token every 5s

interface TrackedStock {
  stockId: string
  symbol: string
  exchange: 'nse' | 'bse'
}

interface TickPayload {
  type: 'tick'
  data: { symbol: string; ltp: number; change: number; changePercent: number; timestamp: string }
}

interface MarketStatusPayload {
  type: 'market_status'
  marketOpen: boolean
  timestamp: string
}

type ServerPayload = TickPayload | MarketStatusPayload

function toIST(date: Date): string {
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
}

class LiveStockFeed {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly tokenToStock = new Map<string, TrackedStock>()
  private readonly lastDbWriteAt = new Map<string, number>()
  private db: PrismaClient | null = null
  private angelOne: AngelOneClient | null = null

  attach(httpServer: HttpServer, angelOne: AngelOneClient, db: PrismaClient): void {
    this.db = db
    this.angelOne = angelOne

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url === STOCK_PRICES_WS_PATH) {
        this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req))
      }
    })

    this.wss.on('connection', (ws: WebSocket) => {
      logger.info({ clients: this.wss.clients.size }, 'LiveStockFeed: client connected')
      this.send(ws, { type: 'market_status', marketOpen: marketStatus.isMarketLive(), timestamp: new Date().toISOString() })
      ws.on('close', () => logger.info({ clients: this.wss.clients.size }, 'LiveStockFeed: client disconnected'))
    })

    marketStatus.on('opened', () => {
      this.broadcastAll({ type: 'market_status', marketOpen: true, timestamp: new Date().toISOString() })
    })
    marketStatus.on('closed', () => {
      this.broadcastAll({ type: 'market_status', marketOpen: false, timestamp: new Date().toISOString() })
    })

    // (Re-)subscribe every tracked token on initial connect and every
    // reconnect, since AngelOne doesn't remember subscriptions across a
    // fresh WS connection.
    angelOne.on('auth', () => {
      void this.refreshTrackedStocks().then(() => this.subscribeAll())
    })

    angelOne.on('tick', tick => {
      marketStatus.recordTick(tick)

      const stock = this.tokenToStock.get(tick.tokenId)
      if (!stock) return // tick for a token we're not tracking (shouldn't normally happen)

      const close = tick.close ?? 0
      const change = close !== 0 ? Math.round((tick.ltp - close) * 100) / 100 : 0
      const changePercent = close !== 0 ? Math.round(((tick.ltp - close) / close) * 10000) / 100 : 0
      const timestamp = toIST(new Date())

      this.broadcastAll({
        type: 'tick',
        data: { symbol: stock.symbol, ltp: tick.ltp, change, changePercent, timestamp },
      })

      this.throttledPersist(stock, tick.ltp)
    })

    void this.refreshTrackedStocks().then(() => this.subscribeAll())
  }

  /** Adds a single stock's token to the live feed immediately — called right after a new recommendation is created, so its price starts flowing without waiting for the next full refresh/reconnect. */
  async ensureSubscribed(stockId: string): Promise<void> {
    if (!this.db || !this.angelOne) return
    const stock = await this.db.stock.findUnique({ where: { id: stockId } })
    if (!stock?.token || !stock.exchange) return
    if (this.tokenToStock.has(stock.token)) return // already tracked

    this.tokenToStock.set(stock.token, { stockId: stock.id, symbol: stock.symbol, exchange: stock.exchange })
    this.angelOne.subscribe([{ exchangeType: EXCHANGE_TYPE[stock.exchange], tokens: [stock.token] }])
    logger.info({ symbol: stock.symbol, token: stock.token }, 'LiveStockFeed: subscribed new stock')
  }

  private async refreshTrackedStocks(): Promise<void> {
    if (!this.db) return
    const stocks = await this.db.stock.findMany({
      where: {
        token: { not: null },
        exchange: { not: null },
        recommendations: { some: { deletedAt: null } },
      },
      select: { id: true, symbol: true, token: true, exchange: true },
    })

    this.tokenToStock.clear()
    for (const s of stocks) {
      if (!s.token || !s.exchange) continue
      this.tokenToStock.set(s.token, { stockId: s.id, symbol: s.symbol, exchange: s.exchange })
    }
    logger.info({ count: this.tokenToStock.size }, 'LiveStockFeed: refreshed tracked stocks')
  }

  private subscribeAll(): void {
    if (!this.angelOne || this.tokenToStock.size === 0) return

    const byExchange = new Map<'nse' | 'bse', string[]>()
    for (const [token, stock] of this.tokenToStock.entries()) {
      const list = byExchange.get(stock.exchange) ?? []
      list.push(token)
      byExchange.set(stock.exchange, list)
    }

    const tokenList: TokenSubscription[] = [...byExchange.entries()].map(([exchange, tokens]) => ({
      exchangeType: EXCHANGE_TYPE[exchange],
      tokens,
    }))
    this.angelOne.subscribe(tokenList)
  }

  private throttledPersist(stock: TrackedStock, ltp: number): void {
    if (!this.db) return
    const lastWrite = this.lastDbWriteAt.get(stock.stockId) ?? 0
    if (Date.now() - lastWrite < DB_WRITE_THROTTLE_MS) return

    this.lastDbWriteAt.set(stock.stockId, Date.now())
    this.db.stock.update({ where: { id: stock.stockId }, data: { cmp: ltp } }).catch(err => {
      logger.error({ err, stockId: stock.stockId }, 'LiveStockFeed: failed to persist cmp')
    })
  }

  private send(ws: WebSocket, payload: ServerPayload): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
  }

  private broadcastAll(payload: ServerPayload): void {
    if (this.wss.clients.size === 0) return
    const json = JSON.stringify(payload)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json)
    }
  }
}

export const liveStockFeed = new LiveStockFeed()
