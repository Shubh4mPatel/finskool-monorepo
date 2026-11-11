import type { PerformanceKind, PerformanceSegment, TradeVisibility } from '../../generated/prisma/client.js'
import type { IntradaySummary, SwingStatus } from './performance.calc.js'

export interface BoardDTO {
  communityId: string
  communityName: string
  communitySlug: string
  kind: PerformanceKind
  segments: PerformanceSegment[]
  hideNewerThanDays: number
  maxFreeTrades: number
  /** Intraday sizing. Present on every board, but only intraday boards use it. */
  capital: number
  margin: number
  chargesPerTrade: number
  /** The admin's own banner text, or null when the default sentence is in use. */
  note: string | null
}

export interface BoardListDTO {
  boards: { communityId: string; name: string; slug: string; kind: PerformanceKind; segments: PerformanceSegment[] }[]
  /** Non-free communities a super admin can still link a board to. Always empty for other admins. */
  unlinked: { communityId: string; name: string; slug: string; type: string | null }[]
}

export interface PeriodDTO {
  id: string
  segment: PerformanceSegment
  /** `YYYY-MM` */
  fromMonth: string
  toMonth: string
  /** What the admin named the card. The app shows this instead of the dates. */
  name: string
  /** The same as `name`; kept for apps built before cards had names. */
  label: string
  /** The card the app opens on. Exactly one per board and segment, and it is listed first. */
  isDefault: boolean
  given: number
  met: number
  metPct: number
}

export interface IntradayRowDTO {
  id: string
  /** 1-based rank by date within the segment, over every trade (not just the ones listed). */
  serialNo: number
  /** `YYYY-MM-DD` */
  tradeDate: string
  name: string
  /** The stock's logo from the stocks table, or null when the stock is not there or has none (draw the initials then). */
  logoUrl: string | null
  side: 'buy' | 'sell'
  entryPrice: number
  exitPrice: number
  plPerShare: number
  plPct: number
  grossPnl: number
  charges: number
  netPnl: number
}

export interface SwingRowDTO {
  id: string
  serialNo: number
  tradeDate: string
  name: string
  symbol: string
  /** The stock's logo from the stocks table, or null when the stock is not there or has none (draw the initials then). */
  logoUrl: string | null
  entryPrice: number
  cmp: number | null
  returnPct: number | null
  status: SwingStatus
  targetPct: number
  targetPrice: number
  analysis: string | null
  exitDate: string | null
  holdingDays: number | null
}

/** A Long Term / US Investment row: what the sheet has, and nothing computed from columns it does not have. */
export interface HoldingRowDTO {
  id: string
  serialNo: number
  tradeDate: string
  name: string
  symbol: string
  logoUrl: string | null
  entryPrice: number
  cmp: number | null
  returnPct: number | null
  analysis: string | null
}

export type TradeRowDTO = IntradayRowDTO | SwingRowDTO | HoldingRowDTO

/** What an admin sees for a row: the numbers plus how free members are treated. */
export type AdminTradeRowDTO = TradeRowDTO & {
  visibility: TradeVisibility
  /** Whether a free member can see this trade right now, after the rule bar. */
  visibleToFree: boolean
}

/** What the app gets for a row. No serial number and no admin controls. */
export type MobileTradeRowDTO = DistributiveOmit<TradeRowDTO, 'serialNo'>
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export interface IntradaySummaryDTO extends IntradaySummary {
  kind: 'intraday'
}

/** Trades Given / Met / Met % for the months a caller picked, worked out on the spot (a period card without an id). */
export interface RangeStatsDTO {
  /** `YYYY-MM` */
  fromMonth: string
  toMonth: string
  /** "Aug26 to Sep26", or "Aug26" for a single month */
  label: string
  given: number
  met: number
  metPct: number
}

export interface SwingSummaryDTO {
  kind: 'swing' | 'investor'
  /** Mean holding days of closed trades, null until one closes. Over the picked months when a filter is given. */
  averageHoldingDays: number | null
  /** Over the picked months when a filter is given. */
  totalTrades: number
  /** The admin's fixed hit-rate cards. They always cover their own months, whatever filter the caller gave. */
  periods: PeriodDTO[]
  /** The hit-rate card for the months the caller picked; null when no month filter was given. */
  range: RangeStatsDTO | null
}

/** Long Term / US Investment: no targets or exit dates, so no holding days or hit-rate cards. */
export interface HoldingSummaryDTO {
  kind: 'holding'
  totalTrades: number
}

export type SummaryDTO = IntradaySummaryDTO | SwingSummaryDTO | HoldingSummaryDTO

export interface OverviewDTO {
  board: BoardDTO
  segment: PerformanceSegment
  summary: SummaryDTO
  /** The intraday banner: the admin's note, or the default sentence built from capital and margin. */
  noteText: string | null
}

export interface TradeListDTO {
  items: AdminTradeRowDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  /** Every `YYYY-MM` that has a trade in this segment, newest first, for the month dropdown. */
  months: string[]
}

export interface ImportRowErrorDTO {
  /** The sheet row, header being row 1. */
  row: number
  /** The stock or code on the row, to help find it. */
  ref: string
  reason: string
}

export interface ImportSummaryDTO {
  total: number
  created: number
  updated: number
  /** Rows that match an existing trade exactly. */
  unchanged: number
  errors: ImportRowErrorDTO[]
  dryRun: boolean
}

export interface MobileBoardListDTO {
  boards: {
    communityId: string
    name: string
    slug: string
    kind: PerformanceKind
    segments: PerformanceSegment[]
    access: 'free' | 'paid'
  }[]
}

export interface MobilePerformanceDTO {
  communityId: string
  communityName: string
  kind: PerformanceKind
  access: 'free' | 'paid'
  segment: PerformanceSegment
  segments: PerformanceSegment[]
  /** The months the caller asked for, echoed back; null when they asked for everything. */
  filter: { fromMonth: string; toMonth: string } | null
  /** Every `YYYY-MM` that has a trade in this segment, newest first, to build the month pickers from. */
  months: string[]
  /** Over every trade in the segment (or in the picked months), the same for free and paid. */
  summary: SummaryDTO
  noteText: string | null
  /** Trades in the segment (or in the picked months) a free viewer cannot see. Null for paid viewers. */
  hiddenCount: number | null
  items: MobileTradeRowDTO[]
  nextCursor: string | null
}
