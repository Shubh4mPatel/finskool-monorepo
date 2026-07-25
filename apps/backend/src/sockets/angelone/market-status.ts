import { EventEmitter } from 'node:events'
import redis from '../../lib/redis.js'
import { logger } from '../../shared/logger.js'
import type { SnapQuoteTick } from './angelone.types.js'

const STALE_MS = 3 * 60 * 1000 // 3 minutes without a tick → feed considered stale
const WATCHDOG_INTERVAL_MS = 15_000 // how often we poll for the close transition

const MARKET_TIMEZONE = 'Asia/Kolkata'
const REDIS_KEY_PREFIX = 'market:opened:'

// Today's IST calendar date as YYYY-MM-DD. Deliberately not
// `new Date().toISOString().slice(0, 10)` — that's UTC-based and gives the
// wrong date between 00:00-05:30 IST.
export function istDateStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  return `${year}-${month}-${day}`
}

// One key per IST calendar day, no TTL — the key is already scoped to that
// day by its own name, so it never needs to expire; tomorrow's first tick
// just writes tomorrow's key.
async function markMarketOpenedToday(): Promise<void> {
  try {
    await redis.set(REDIS_KEY_PREFIX + istDateStr(), 'open')
  } catch (err) {
    logger.warn({ err }, 'MarketStatus: failed to write opened flag')
  }
}

async function markMarketClosedToday(): Promise<void> {
  try {
    await redis.set(REDIS_KEY_PREFIX + istDateStr(), 'closed')
  } catch (err) {
    logger.warn({ err }, 'MarketStatus: failed to write closed flag')
  }
}

// Declaration merging: typed overloads for EventEmitter.on / emit
export declare interface MarketStatus {
  on(event: 'opened', listener: () => void): this
  on(event: 'closed', listener: () => void): this
  emit(event: 'opened'): boolean
  emit(event: 'closed'): boolean
}

export class MarketStatus extends EventEmitter {
  private lastTickAt: number | null = null
  // Tracks the previous live/dead state so 'opened'/'closed' fire only on the
  // transition, not on every tick or every watchdog poll.
  private wasLive = false

  constructor() {
    super()
    setInterval(() => this.checkForClose(), WATCHDOG_INTERVAL_MS).unref()
  }

  // Called on every AngelOne tick (cash-equity segments only — see
  // live-stock-feed.ts). Purely tick-driven — no clock window — so a session
  // starting outside the usual hours (e.g. Muhurat trading) is detected the
  // same way as a normal trading day.
  //
  // AngelOne pushes an immediate "last known quote" snapshot the moment a
  // token is (re-)subscribed — including on every server restart, when
  // previously-active tokens get replayed — regardless of whether the
  // market is actually live right now. That packet is indistinguishable
  // from a real trade by arrival alone, so a stale one would otherwise be
  // read as "the market just opened". Guard against it using the packet's
  // own exchange timestamp: only treat a tick as proof of live trading if
  // it happened recently, not just that it arrived recently.
  recordTick(tick?: SnapQuoteTick): void {
    if (tick?.exchTs && Date.now() - new Date(tick.exchTs).getTime() > STALE_MS) {
      return
    }

    const isOpening = !this.wasLive
    this.lastTickAt = Date.now()
    this.wasLive = true

    if (isOpening) {
      this.emit('opened')
      void markMarketOpenedToday()
      logger.info(tick ? {
        token: tick.tokenId,
        ltp: tick.ltp,
        exchTs: tick.exchTs,
        ltTs: tick.ltTs,
      } : {}, 'MarketStatus: market opened')
    }
  }

  // Live purely based on tick freshness — catches both off-hours and a
  // stalled/disconnected feed during the day, regardless of clock time.
  isMarketLive(): boolean {
    if (this.lastTickAt === null) return false
    return Date.now() - this.lastTickAt < STALE_MS
  }

  // Runs on a timer rather than reacting to a tick, since there's nothing to
  // react to once ticks stop — detects the live -> stale transition and fires
  // 'closed' exactly once per transition.
  private checkForClose(): void {
    if (this.wasLive && !this.isMarketLive()) {
      this.wasLive = false
      this.emit('closed')
      void markMarketClosedToday()
      logger.info('MarketStatus: market closed')
    }
  }
}

export const marketStatus = new MarketStatus()
