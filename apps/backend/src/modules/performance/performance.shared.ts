import type { PerformanceKind, PerformanceSegment } from '../../generated/prisma/client.js'
import { BadRequestError } from '../../shared/errors/index.js'

/** The segments a board of each kind is split into. Intraday and swing have one; investor has three tabs. */
export const SEGMENTS_BY_KIND: Record<PerformanceKind, readonly PerformanceSegment[]> = {
  intraday: ['main'],
  swing: ['main'],
  investor: ['investor', 'long_term', 'us_investment'],
}

/** The segment to use when the caller does not pick one; a segment that does not belong to the kind is a 400. */
export function resolveSegment(kind: PerformanceKind, segment: PerformanceSegment | undefined): PerformanceSegment {
  const allowed = SEGMENTS_BY_KIND[kind]
  if (segment === undefined) return allowed[0]!
  if (!allowed.includes(segment)) {
    throw new BadRequestError(`A ${kind} board has no "${segment}" segment`, 'INVALID_SEGMENT')
  }
  return segment
}

/** `YYYY-MM-DD` of a calendar date as Prisma reads it (midnight UTC). */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10)

/** `YYYY-MM` of a calendar date. */
export const isoMonth = (d: Date): string => d.toISOString().slice(0, 7)

/** Midnight UTC of a `YYYY-MM-DD` string. Validated upstream. */
export const parseIsoDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`)

/** First day of a `YYYY-MM` month, as a calendar date. */
export const parseIsoMonth = (s: string): Date => new Date(`${s}-01T00:00:00.000Z`)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct25", the way the period cards name their range ends. */
export const shortMonth = (d: Date): string => `${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`

interface KeyFields {
  /** `YYYY-MM-DD` */
  tradeDate: string
  name: string
  symbol: string | null
  side: 'buy' | 'sell' | null
  entryPrice: number
}

const squash = (s: string): string => s.trim().replace(/\s+/g, ' ').toUpperCase()

/**
 * The natural key a re-uploaded row is matched on, so the same trade updates instead of duplicating. Swing and
 * investor trades are one per day per stock; intraday can repeat a stock in a day, so side and entry price join
 * the key (a changed entry price therefore reads as a different trade).
 */
export function buildTradeKey(kind: PerformanceKind, t: KeyFields): string {
  if (kind === 'intraday') return `${t.tradeDate}|${squash(t.name)}|${t.side ?? ''}|${t.entryPrice.toFixed(2)}`
  return `${t.tradeDate}|${squash(t.symbol ?? t.name)}`
}
