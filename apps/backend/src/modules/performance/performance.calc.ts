// Every number the Performance screen shows is derived here from a trade's raw inputs, on read, so editing a
// board's capital / margin / charges re-prices its whole history. Pure functions over plain numbers and calendar
// dates (midnight UTC, the way Prisma reads a `@db.Date` column): no database, no clock.

/** Round to 2 decimals, away from zero on exact halves, without the usual 1.005 float surprise. */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1
  return (sign * Math.round((Math.abs(n) + Number.EPSILON) * 100)) / 100
}

/** Round to whole rupees, away from zero on exact halves. */
export function roundRupee(n: number): number {
  return (n < 0 ? -1 : 1) * Math.round(Math.abs(n))
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole calendar days from `from` to `to` (both midnight UTC). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

// ─── Intraday ───────────────────────────────────────────────────────────────

export interface IntradayParams {
  capital: number
  margin: number
  chargesPerTrade: number
}

export interface IntradayInput {
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number
}

export interface IntradayResult {
  /** Rupees gained per share: exit - entry for a buy, entry - exit for a sell. */
  plPerShare: number
  /** plPerShare as a % of entry, scaled by the margin. */
  plPct: number
  /** Whole rupees, before charges. Quantity is capital x margin / entry and is not rounded to whole shares. */
  grossPnl: number
  charges: number
  netPnl: number
}

export function intradayTrade(t: IntradayInput, p: IntradayParams): IntradayResult {
  const plPerShare = round2(t.side === 'buy' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice)
  const plPct = round2((plPerShare / t.entryPrice) * p.margin * 100)
  const grossPnl = roundRupee(((p.capital * p.margin) / t.entryPrice) * plPerShare)
  return { plPerShare, plPct, grossPnl, charges: p.chargesPerTrade, netPnl: grossPnl - p.chargesPerTrade }
}

export interface IntradaySummary {
  capitalDeployed: number
  grossPnl: number
  totalCharges: number
  overallPnl: number
  totalTrades: number
  profitMakingTrades: number
  lossMakingTrades: number
  /** Share of all trades with a positive / negative gross P&L, in %. Flat trades count in neither. */
  profitMakingPct: number
  lossMakingPct: number
}

export function intradaySummary(results: IntradayResult[], p: IntradayParams): IntradaySummary {
  const totalTrades = results.length
  const grossPnl = results.reduce((sum, r) => sum + r.grossPnl, 0)
  const totalCharges = results.reduce((sum, r) => sum + r.charges, 0)
  const profitMakingTrades = results.filter(r => r.grossPnl > 0).length
  const lossMakingTrades = results.filter(r => r.grossPnl < 0).length
  const pct = (n: number) => (totalTrades === 0 ? 0 : round2((n / totalTrades) * 100))
  return {
    capitalDeployed: p.capital,
    grossPnl,
    totalCharges,
    overallPnl: grossPnl - totalCharges,
    totalTrades,
    profitMakingTrades,
    lossMakingTrades,
    profitMakingPct: pct(profitMakingTrades),
    lossMakingPct: pct(lossMakingTrades),
  }
}

// ─── Swing / investor ───────────────────────────────────────────────────────

/** Target when the sheet does not give one. */
export const DEFAULT_TARGET_PCT = { swing: 5, investor: 10 } as const

export interface SwingInput {
  tradeDate: Date
  entryPrice: number
  cmp: number | null
  targetPct: number | null
  exitDate: Date | null
}

export type SwingStatus = 'open' | 'target_met'

export interface SwingResult {
  targetPct: number
  targetPrice: number
  /** Against CMP, whatever the status. Null when the trade has no CMP. */
  returnPct: number | null
  /** A trade with an exit date has met its target. */
  status: SwingStatus
  /** Calendar days from trade date to exit date. Null while the trade is open. */
  holdingDays: number | null
}

export function swingTrade(t: SwingInput, kind: keyof typeof DEFAULT_TARGET_PCT): SwingResult {
  const targetPct = t.targetPct ?? DEFAULT_TARGET_PCT[kind]
  return {
    targetPct,
    targetPrice: round2(t.entryPrice * (1 + targetPct / 100)),
    returnPct: t.cmp === null ? null : round2(((t.cmp - t.entryPrice) / t.entryPrice) * 100),
    status: t.exitDate === null ? 'open' : 'target_met',
    holdingDays: t.exitDate === null ? null : daysBetween(t.tradeDate, t.exitDate),
  }
}

/** Mean holding days of closed trades, to 1 decimal. Null when nothing has closed yet. */
export function averageHoldingDays(results: SwingResult[]): number | null {
  const days = results.flatMap(r => (r.holdingDays === null ? [] : [r.holdingDays]))
  if (days.length === 0) return null
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
}

/**
 * A Long Term or US Investment holding. The sheets for these segments carry only entry, CMP and Returns: no target,
 * no exit date, so there is no target price, status or holding days to work out (and none are made up).
 */
export function holdingTrade(t: { entryPrice: number; cmp: number | null }): { returnPct: number | null } {
  return { returnPct: t.cmp === null ? null : round2(((t.cmp - t.entryPrice) / t.entryPrice) * 100) }
}

export interface PeriodStats {
  /** Trades dated inside the period. */
  given: number
  /** Of those, trades that have met their target. */
  met: number
  metPct: number
}

/** `fromMonth` and `toMonth` are the first day of a month; the period runs from the first day of `fromMonth`
 *  to the last day of `toMonth`. */
export function periodStats(
  trades: { tradeDate: Date; status: SwingStatus }[],
  fromMonth: Date,
  toMonth: Date,
): PeriodStats {
  const end = Date.UTC(toMonth.getUTCFullYear(), toMonth.getUTCMonth() + 1, 1)
  const inRange = trades.filter(t => t.tradeDate.getTime() >= fromMonth.getTime() && t.tradeDate.getTime() < end)
  const met = inRange.filter(t => t.status === 'target_met').length
  return { given: inRange.length, met, metPct: inRange.length === 0 ? 0 : round2((met / inRange.length) * 100) }
}
