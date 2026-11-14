import { Prisma } from '../../generated/prisma/client.js'
import type {
  PerformanceBoard,
  PerformanceKind,
  PerformanceSegment,
  PerformanceTrade,
  PrismaClient,
  TradeVisibility,
} from '../../generated/prisma/client.js'
import {
  assertCommunityAccessFromToken,
  getPaidCommunityIds,
  hasCommunityAccess,
  isPaidMemberOfCommunity,
} from '../../lib/community-access.js'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { calendarDate, istNow } from '../dashboard/dashboard.time.js'
import {
  averageHoldingDays,
  holdingTrade,
  intradaySummary,
  intradayTrade,
  periodStats,
  round2,
  swingTrade,
  type IntradayParams,
} from './performance.calc.js'
import type {
  AdminTradeRowDTO,
  BoardDTO,
  BoardListDTO,
  HoldingRowDTO,
  ImportRowErrorDTO,
  ImportSummaryDTO,
  IntradayRowDTO,
  MobileBoardListDTO,
  MobilePerformanceDTO,
  MobileTradeRowDTO,
  OverviewDTO,
  PeriodDTO,
  SummaryDTO,
  SwingRowDTO,
  TradeListDTO,
  TradeRowDTO,
} from './performance.dto.js'
import {
  SEGMENTS_BY_KIND,
  buildTradeKey,
  inMonthRange,
  isHoldingSegment,
  isoDate,
  isoMonth,
  monthRangeOf,
  parseIsoDate,
  parseIsoMonth,
  rangeLabel,
  resolveSegment,
  type MonthRange,
} from './performance.shared.js'
import {
  holdingPatchSchema,
  holdingTradeSchema,
  intradayPatchSchema,
  intradayTradeSchema,
  swingPatchSchema,
  swingTradeSchema,
  type ListTradesQuery,
  type MobileTradesQuery,
  type SettingsInput,
} from './performance.validator.js'
import { freeVisibleIds, type VisibilityRules } from './performance.visibility.js'

type BoardWithCommunity = PerformanceBoard & { community: { name: string; slug: string; deletedAt: Date | null } }

/** A trade as the calculations see it: Decimals turned into numbers. */
interface TradeRow {
  id: string
  tradeDate: Date
  createdAt: Date
  name: string
  symbol: string | null
  side: 'buy' | 'sell' | null
  entryPrice: number
  exitPrice: number | null
  /** Intraday: this trade's own charges; null means the board's default. */
  charges: number | null
  cmp: number | null
  targetPct: number | null
  analysis: string | null
  theme: string | null
  exitDate: Date | null
  visibility: TradeVisibility
}

/** A validated trade, ready to write. Optional fields are `undefined` when the caller did not give them. */
interface Candidate {
  tradeDate: string
  name: string
  symbol: string | null
  side: 'buy' | 'sell' | null
  entryPrice: number
  exitPrice: number | null
  charges: number | null | undefined
  cmp: number | null | undefined
  targetPct: number | null | undefined
  analysis: string | null | undefined
  theme: string | null | undefined
  exitDate: string | null | undefined
  visibility: TradeVisibility | undefined
}

const MAX_PERIODS_PER_SEGMENT = 20

// The mobile list pages by S.N.: the cursor is the S.N. of the last row of the previous page.
const encodeSerialCursor = (serialNo: number): string => Buffer.from(`sn:${serialNo}`).toString('base64url')
function decodeSerialCursor(cursor: string): number {
  const m = /^sn:(\d{1,9})$/.exec(Buffer.from(cursor, 'base64url').toString())
  if (!m) throw new BadRequestError('Invalid cursor', 'INVALID_CURSOR')
  return Number(m[1])
}

const num = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d))

/** Today's calendar day in IST as a midnight-UTC date, the way trade dates are stored. */
function todayIst(): Date {
  const t = istNow(new Date())
  return calendarDate(t.year, t.month, t.day)
}

function toTradeRow(t: PerformanceTrade): TradeRow {
  return {
    id: t.id,
    tradeDate: t.tradeDate,
    createdAt: t.createdAt,
    name: t.name,
    symbol: t.symbol,
    side: t.side,
    entryPrice: Number(t.entryPrice),
    exitPrice: num(t.exitPrice),
    charges: num(t.charges),
    cmp: num(t.cmp),
    targetPct: num(t.targetPct),
    analysis: t.analysis,
    theme: t.theme,
    exitDate: t.exitDate,
    visibility: t.visibility,
  }
}

const intradayParams = (b: PerformanceBoard): IntradayParams => ({
  capital: Number(b.capital),
  margin: Number(b.margin),
  chargesPerTrade: Number(b.chargesPerTrade),
})

const rulesOf = (b: PerformanceBoard): VisibilityRules => ({
  hideNewerThanDays: b.hideNewerThanDays,
  maxFreeTrades: b.maxFreeTrades,
})

/** The intraday banner: the admin's own text, or the default sentence built from capital and margin. */
function noteText(b: PerformanceBoard): string | null {
  if (b.kind !== 'intraday') return null
  if (b.note) return b.note
  const p = intradayParams(b)
  return `All calculations are done assuming INR ${p.capital.toLocaleString('en-IN')} capital deployed and ${p.margin}X margin used in each trade.`
}

/** Every Add trade form, edit and sheet row is validated by the schema for the board's kind. */
const tradeSchemaFor = (kind: PerformanceKind, segment: PerformanceSegment) =>
  kind === 'intraday' ? intradayTradeSchema : isHoldingSegment(segment) ? holdingTradeSchema : swingTradeSchema
const patchSchemaFor = (kind: PerformanceKind, segment: PerformanceSegment) =>
  kind === 'intraday' ? intradayPatchSchema : isHoldingSegment(segment) ? holdingPatchSchema : swingPatchSchema

export class PerformanceService {
  constructor(private readonly db: PrismaClient) {}

  // ─── Shared reads ─────────────────────────────────────────────────────────

  private toBoardDTO(b: BoardWithCommunity): BoardDTO {
    return {
      communityId: b.communityId,
      communityName: b.community.name,
      communitySlug: b.community.slug,
      kind: b.kind,
      segments: [...SEGMENTS_BY_KIND[b.kind]],
      hideNewerThanDays: b.hideNewerThanDays,
      maxFreeTrades: b.maxFreeTrades,
      capital: Number(b.capital),
      margin: Number(b.margin),
      chargesPerTrade: Number(b.chargesPerTrade),
      note: b.note,
    }
  }

  private async findBoard(communityId: string): Promise<BoardWithCommunity> {
    const board = await this.db.performanceBoard.findUnique({
      where: { communityId },
      include: { community: { select: { name: true, slug: true, deletedAt: true } } },
    })
    if (!board || board.community.deletedAt) {
      throw new NotFoundError('This community has no Performance board', 'PERFORMANCE_BOARD_NOT_FOUND')
    }
    return board
  }

  private async adminBoard(accessible: string[] | null, communityId: string): Promise<BoardWithCommunity> {
    assertCommunityAccessFromToken(accessible, communityId)
    return this.findBoard(communityId)
  }

  /** Every trade in a segment, oldest first: the order S.N. is counted in. */
  private async segmentTrades(boardId: string, segment: PerformanceSegment): Promise<TradeRow[]> {
    const rows = await this.db.performanceTrade.findMany({
      where: { boardId, segment },
      orderBy: [{ tradeDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    return rows.map(toTradeRow)
  }

  /**
   * Logos for the trades being shown, from the stocks table. A swing or investor trade is matched on its NSE code; an intraday
   * trade has none, so its name is tried as a code (`TATASTEEL`) and then as the stock's name (`Tata Steel Ltd`), ignoring case.
   * Only rows that have a logo are looked up, so a stock without one simply comes back absent and the app shows initials.
   */
  private async logosFor(trades: TradeRow[]): Promise<Map<string, string>> {
    const keyOf = (t: TradeRow) => (t.symbol ?? t.name).trim().toUpperCase()
    const keys = [...new Set(trades.map(keyOf).filter(k => k.length > 0))]
    const logos = new Map<string, string>()
    if (keys.length === 0) return logos

    const stocks = await this.db.stock.findMany({
      where: { logoUrl: { not: null }, OR: [{ symbol: { in: keys } }, { name: { in: [...new Set(trades.map(t => t.name.trim()))] } }] },
      select: { symbol: true, name: true, logoUrl: true },
    })
    const bySymbol = new Map(stocks.map(s => [s.symbol.toUpperCase(), s.logoUrl!]))
    const byName = new Map(stocks.map(s => [s.name.trim().toUpperCase(), s.logoUrl!]))
    for (const t of trades) {
      const logo = bySymbol.get(keyOf(t)) ?? (t.symbol === null ? byName.get(t.name.trim().toUpperCase()) : undefined)
      if (logo) logos.set(t.id, logo)
    }
    return logos
  }

  private toRow(board: PerformanceBoard, segment: PerformanceSegment, t: TradeRow, serialNo: number, logos: Map<string, string>): TradeRowDTO {
    const base = { id: t.id, serialNo, tradeDate: isoDate(t.tradeDate), name: t.name, logoUrl: logos.get(t.id) ?? null, entryPrice: t.entryPrice }
    if (board.kind === 'intraday') {
      const row: IntradayRowDTO = {
        ...base,
        side: t.side!,
        exitPrice: t.exitPrice!,
        ...intradayTrade({ side: t.side!, entryPrice: t.entryPrice, exitPrice: t.exitPrice!, charges: t.charges }, intradayParams(board)),
      }
      return row
    }
    if (isHoldingSegment(segment)) {
      const row: HoldingRowDTO = {
        ...base,
        symbol: t.symbol ?? '',
        cmp: t.cmp,
        analysis: t.analysis,
        theme: t.theme,
        ...holdingTrade({ entryPrice: t.entryPrice, cmp: t.cmp }),
      }
      return row
    }
    const row: SwingRowDTO = {
      ...base,
      symbol: t.symbol ?? '',
      cmp: t.cmp,
      analysis: t.analysis,
      exitDate: t.exitDate === null ? null : isoDate(t.exitDate),
      ...swingTrade(
        { tradeDate: t.tradeDate, entryPrice: t.entryPrice, cmp: t.cmp, targetPct: t.targetPct, exitDate: t.exitDate },
        board.kind as 'swing' | 'investor',
      ),
    }
    return row
  }

  /**
   * Board-wide numbers, over every trade in the segment whoever is looking. A mobile caller can narrow them to some
   * months with `range`; the admin's fixed period cards still cover their own months either way.
   */
  private async summarise(
    board: PerformanceBoard,
    segment: PerformanceSegment,
    trades: TradeRow[],
    range: MonthRange | null = null,
  ): Promise<SummaryDTO> {
    const scoped = range === null ? trades : trades.filter(t => inMonthRange(t.tradeDate, range))

    if (board.kind === 'intraday') {
      const params = intradayParams(board)
      const results = scoped.map(t => intradayTrade({ side: t.side!, entryPrice: t.entryPrice, exitPrice: t.exitPrice!, charges: t.charges }, params))
      return { kind: 'intraday', ...intradaySummary(results, params) }
    }

    // Long Term / US Investment have no targets or exit dates: just how many holdings there are.
    if (isHoldingSegment(segment)) return { kind: 'holding', totalTrades: scoped.length }

    const kind = board.kind as 'swing' | 'investor'
    const results = trades.map(t =>
      swingTrade({ tradeDate: t.tradeDate, entryPrice: t.entryPrice, cmp: t.cmp, targetPct: t.targetPct, exitDate: t.exitDate }, kind),
    )
    const withStatus = trades.map((t, i) => ({ tradeDate: t.tradeDate, status: results[i]!.status }))
    const scopedResults = results.filter((_, i) => inMonthRange(trades[i]!.tradeDate, range))
    const periods = await this.db.performancePeriod.findMany({
      where: { boardId: board.id, segment },
      // The default card first (the app opens on it), then the rest in the order the admin made them.
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    })
    const periodDTOs: PeriodDTO[] = periods.map(p => ({
      id: p.id,
      segment: p.segment,
      fromMonth: isoMonth(p.fromMonth),
      toMonth: isoMonth(p.toMonth),
      name: p.name,
      label: p.name,
      isDefault: p.isDefault,
      ...periodStats(withStatus, p.fromMonth, p.toMonth),
    }))
    return {
      kind,
      averageHoldingDays: averageHoldingDays(scopedResults),
      totalTrades: scopedResults.length,
      periods: periodDTOs,
      range:
        range === null
          ? null
          : {
              fromMonth: range.from,
              toMonth: range.to,
              label: rangeLabel(range),
              ...periodStats(withStatus, parseIsoMonth(range.from), parseIsoMonth(range.to)),
            },
    }
  }

  // ─── Admin: boards ────────────────────────────────────────────────────────

  /** Boards the admin can open, and (super admins only) the communities a board could still be linked to. */
  async listBoards(accessible: string[] | null): Promise<BoardListDTO> {
    const boards = await this.db.performanceBoard.findMany({
      where: {
        community: { deletedAt: null },
        ...(accessible === null ? {} : { communityId: { in: accessible } }),
      },
      include: { community: { select: { name: true, slug: true, deletedAt: true } } },
      orderBy: { createdAt: 'asc' },
    })

    const unlinked =
      accessible === null
        ? await this.db.community.findMany({
            where: { deletedAt: null, isFree: false, performanceBoard: null },
            select: { id: true, name: true, slug: true, type: true },
            orderBy: { name: 'asc' },
          })
        : []

    return {
      boards: boards.map(b => ({
        communityId: b.communityId,
        name: b.community.name,
        slug: b.community.slug,
        kind: b.kind,
        segments: [...SEGMENTS_BY_KIND[b.kind]],
      })),
      unlinked: unlinked.map(c => ({ communityId: c.id, name: c.name, slug: c.slug, type: c.type })),
    }
  }

  async createBoard(isSuperAdmin: boolean, input: { communityId: string; kind: PerformanceKind }): Promise<BoardDTO> {
    if (!isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')

    const community = await this.db.community.findFirst({
      where: { id: input.communityId, deletedAt: null },
      select: { id: true, isFree: true },
    })
    if (!community) throw new NotFoundError('Community not found')
    if (community.isFree) throw new BadRequestError('The free community cannot have a Performance board', 'FREE_COMMUNITY')

    try {
      const board = await this.db.performanceBoard.create({
        data: { communityId: input.communityId, kind: input.kind },
        include: { community: { select: { name: true, slug: true, deletedAt: true } } },
      })
      logger.info({ communityId: input.communityId, kind: input.kind }, 'performance.createBoard: success')
      return this.toBoardDTO(board)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('This community already has a Performance board', 'BOARD_EXISTS')
      }
      throw err
    }
  }

  async getOverview(accessible: string[] | null, communityId: string, requested: PerformanceSegment | undefined): Promise<OverviewDTO> {
    const board = await this.adminBoard(accessible, communityId)
    const segment = resolveSegment(board.kind, requested)
    const trades = await this.segmentTrades(board.id, segment)
    return { board: this.toBoardDTO(board), segment, summary: await this.summarise(board, segment, trades), noteText: noteText(board) }
  }

  async updateSettings(accessible: string[] | null, communityId: string, input: SettingsInput): Promise<BoardDTO> {
    const board = await this.adminBoard(accessible, communityId)

    const sizing = input.capital !== undefined || input.margin !== undefined || input.chargesPerTrade !== undefined || input.note !== undefined
    if (sizing && board.kind !== 'intraday') {
      throw new BadRequestError('Capital, margin, charges and the note apply to intraday boards only', 'NOT_INTRADAY')
    }

    const updated = await this.db.performanceBoard.update({
      where: { id: board.id },
      data: {
        ...(input.hideNewerThanDays !== undefined && { hideNewerThanDays: input.hideNewerThanDays }),
        ...(input.maxFreeTrades !== undefined && { maxFreeTrades: input.maxFreeTrades }),
        ...(input.capital !== undefined && { capital: input.capital }),
        ...(input.margin !== undefined && { margin: input.margin }),
        ...(input.chargesPerTrade !== undefined && { chargesPerTrade: input.chargesPerTrade }),
        ...(input.note !== undefined && { note: input.note === '' ? null : input.note }),
      },
      include: { community: { select: { name: true, slug: true, deletedAt: true } } },
    })
    return this.toBoardDTO(updated)
  }

  // ─── Admin: trades ────────────────────────────────────────────────────────

  async listTrades(accessible: string[] | null, communityId: string, q: ListTradesQuery): Promise<TradeListDTO> {
    const board = await this.adminBoard(accessible, communityId)
    const segment = resolveSegment(board.kind, q.segment)
    const trades = await this.segmentTrades(board.id, segment)
    const visible = freeVisibleIds(trades, rulesOf(board), todayIst())

    const months = [...new Set(trades.map(t => isoMonth(t.tradeDate)))].sort().reverse()

    // Always in S.N. order (oldest first), the order the sheet reads in. S.N. counts over every trade in the
    // segment, so a month view keeps the numbers the whole list would have.
    const numbered = trades.map((t, i) => ({ t, serialNo: i + 1 }))
    const filtered = q.month ? numbered.filter(n => isoMonth(n.t.tradeDate) === q.month) : numbered

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / q.pageSize))
    const pageRows = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
    const logos = await this.logosFor(pageRows.map(n => n.t))
    const items: AdminTradeRowDTO[] = pageRows.map(({ t, serialNo }) => ({
      ...this.toRow(board, segment, t, serialNo, logos),
      ...(board.kind === 'intraday' ? { ownCharges: t.charges } : {}),
      visibility: t.visibility,
      visibleToFree: visible.has(t.id),
    }))

    return { items, total, page: q.page, pageSize: q.pageSize, totalPages, months }
  }

  /** A validated body into the stored fields, or a 400 explaining which date is wrong. */
  private toCandidate(kind: PerformanceKind, segment: PerformanceSegment, parsed: Record<string, unknown>): Candidate {
    const holding = isHoldingSegment(segment)
    const get = <T>(key: string): T | undefined => parsed[key] as T | undefined
    const candidate: Candidate = {
      tradeDate: get<string>('tradeDate')!,
      name: get<string>('name')!,
      symbol: kind === 'intraday' ? null : get<string>('symbol')!,
      side: kind === 'intraday' ? get<'buy' | 'sell'>('side')! : null,
      entryPrice: get<number>('entryPrice')!,
      exitPrice: kind === 'intraday' ? get<number>('exitPrice')! : null,
      charges: kind === 'intraday' ? get<number | null>('charges') : undefined,
      cmp: kind === 'intraday' ? undefined : get<number | null>('cmp'),
      targetPct: kind === 'intraday' || holding ? undefined : get<number | null>('targetPct'),
      analysis: kind === 'intraday' ? undefined : get<string | null>('analysis'),
      theme: holding ? get<string | null>('theme') : undefined,
      exitDate: kind === 'intraday' || holding ? undefined : get<string | null>('exitDate'),
      visibility: get<TradeVisibility>('visibility'),
    }
    if (typeof candidate.exitDate === 'string' && candidate.exitDate < candidate.tradeDate) {
      throw new BadRequestError('Exit date cannot be before the trade date', 'INVALID_EXIT_DATE')
    }
    return candidate
  }

  private candidateKey(kind: PerformanceKind, c: Candidate): string {
    return buildTradeKey(kind, { tradeDate: c.tradeDate, name: c.name, symbol: c.symbol, side: c.side, entryPrice: c.entryPrice })
  }

  async createTrade(
    accessible: string[] | null,
    communityId: string,
    requested: PerformanceSegment | undefined,
    body: unknown,
  ): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    const segment = resolveSegment(board.kind, requested)
    const c = this.toCandidate(board.kind, segment, tradeSchemaFor(board.kind, segment).parse(body))

    try {
      const created = await this.db.performanceTrade.create({
        data: {
          boardId: board.id,
          segment,
          tradeKey: this.candidateKey(board.kind, c),
          tradeDate: parseIsoDate(c.tradeDate),
          name: c.name,
          symbol: c.symbol,
          side: c.side,
          entryPrice: c.entryPrice,
          exitPrice: c.exitPrice,
          charges: c.charges ?? null,
          cmp: c.cmp ?? null,
          targetPct: c.targetPct ?? null,
          analysis: c.analysis ?? null,
          theme: c.theme ?? null,
          exitDate: c.exitDate ? parseIsoDate(c.exitDate) : null,
          visibility: c.visibility ?? 'auto',
        },
        select: { id: true },
      })
      return created
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('That trade is already on the board', 'TRADE_EXISTS')
      }
      throw err
    }
  }

  async updateTrade(accessible: string[] | null, communityId: string, tradeId: string, body: unknown): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    const existing = await this.db.performanceTrade.findFirst({ where: { id: tradeId, boardId: board.id } })
    if (!existing) throw new NotFoundError('Trade not found')

    const parsed = patchSchemaFor(board.kind, existing.segment).parse(body) as Record<string, unknown>
    const has = (key: string) => parsed[key] !== undefined

    // Merge over what is stored, so the date check and the trade key see the whole trade.
    const merged = this.toCandidate(board.kind, existing.segment, {
      tradeDate: has('tradeDate') ? parsed['tradeDate'] : isoDate(existing.tradeDate),
      name: has('name') ? parsed['name'] : existing.name,
      symbol: has('symbol') ? parsed['symbol'] : existing.symbol,
      side: has('side') ? parsed['side'] : existing.side,
      entryPrice: has('entryPrice') ? parsed['entryPrice'] : Number(existing.entryPrice),
      exitPrice: has('exitPrice') ? parsed['exitPrice'] : num(existing.exitPrice),
      charges: has('charges') ? parsed['charges'] : num(existing.charges),
      cmp: has('cmp') ? parsed['cmp'] : num(existing.cmp),
      targetPct: has('targetPct') ? parsed['targetPct'] : num(existing.targetPct),
      analysis: has('analysis') ? parsed['analysis'] : existing.analysis,
      theme: has('theme') ? parsed['theme'] : existing.theme,
      exitDate: has('exitDate') ? parsed['exitDate'] : existing.exitDate === null ? null : isoDate(existing.exitDate),
      visibility: has('visibility') ? parsed['visibility'] : existing.visibility,
    })

    try {
      await this.db.performanceTrade.update({
        where: { id: existing.id },
        data: {
          tradeKey: this.candidateKey(board.kind, merged),
          tradeDate: parseIsoDate(merged.tradeDate),
          name: merged.name,
          symbol: merged.symbol,
          side: merged.side,
          entryPrice: merged.entryPrice,
          exitPrice: merged.exitPrice,
          charges: merged.charges ?? null,
          cmp: merged.cmp ?? null,
          targetPct: merged.targetPct ?? null,
          analysis: merged.analysis ?? null,
          theme: merged.theme ?? null,
          exitDate: merged.exitDate ? parseIsoDate(merged.exitDate) : null,
          visibility: merged.visibility ?? 'auto',
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('That trade is already on the board', 'TRADE_EXISTS')
      }
      throw err
    }
    return { id: existing.id }
  }

  async deleteTrade(accessible: string[] | null, communityId: string, tradeId: string): Promise<void> {
    const board = await this.adminBoard(accessible, communityId)
    const { count } = await this.db.performanceTrade.deleteMany({ where: { id: tradeId, boardId: board.id } })
    if (count === 0) throw new NotFoundError('Trade not found')
  }

  // ─── Admin: sheet import ──────────────────────────────────────────────────

  /**
   * Upsert a parsed sheet. A row that matches an existing trade on its key updates it (only the cells the row
   * actually fills in; a blank cell leaves the stored value alone), anything else is added. Free-member
   * visibility is never touched by an upload. Bad rows are reported per row and the rest still go in; the
   * writes themselves are one transaction. `dryRun` reports what would happen without writing.
   */
  async importTrades(
    accessible: string[] | null,
    communityId: string,
    input: { segment?: PerformanceSegment | undefined; dryRun: boolean; rows: Record<string, unknown>[] },
  ): Promise<ImportSummaryDTO> {
    const board = await this.adminBoard(accessible, communityId)
    const segment = resolveSegment(board.kind, input.segment)
    const schema = tradeSchemaFor(board.kind, segment)

    const errors: ImportRowErrorDTO[] = []
    const valid: { row: number; key: string; c: Candidate }[] = []
    const firstRowOfKey = new Map<string, number>()

    input.rows.forEach((raw, index) => {
      const hint = raw['row']
      const row = typeof hint === 'number' && Number.isInteger(hint) && hint >= 2 ? hint : index + 2
      const ref = String(raw['symbol'] ?? raw['name'] ?? '').slice(0, 60)

      const result = schema.safeParse(raw)
      if (!result.success) {
        errors.push({ row, ref, reason: [...new Set(result.error.issues.map(i => i.message))].join('; ') })
        return
      }
      let c: Candidate
      try {
        c = this.toCandidate(board.kind, segment, result.data as Record<string, unknown>)
      } catch (err) {
        errors.push({ row, ref, reason: err instanceof BadRequestError ? err.message : 'Invalid row' })
        return
      }
      const key = this.candidateKey(board.kind, c)
      const earlier = firstRowOfKey.get(key)
      if (earlier !== undefined) {
        errors.push({ row, ref, reason: `Same trade as row ${earlier} in this sheet` })
        return
      }
      firstRowOfKey.set(key, row)
      valid.push({ row, key, c })
    })

    const existing = await this.db.performanceTrade.findMany({
      where: { boardId: board.id, segment, tradeKey: { in: valid.map(v => v.key) } },
    })
    const byKey = new Map(existing.map(t => [t.tradeKey, t]))

    const creates: Prisma.PerformanceTradeCreateManyInput[] = []
    const updateOps: Prisma.PrismaPromise<unknown>[] = []
    let updated = 0
    let unchanged = 0

    for (const { key, c } of valid) {
      const current = byKey.get(key)
      if (!current) {
        creates.push({
          boardId: board.id,
          segment,
          tradeKey: key,
          tradeDate: parseIsoDate(c.tradeDate),
          name: c.name,
          symbol: c.symbol,
          side: c.side,
          entryPrice: c.entryPrice,
          exitPrice: c.exitPrice,
          charges: c.charges ?? null,
          cmp: c.cmp ?? null,
          targetPct: c.targetPct ?? null,
          analysis: c.analysis ?? null,
          theme: c.theme ?? null,
          exitDate: c.exitDate ? parseIsoDate(c.exitDate) : null,
          visibility: c.visibility ?? 'auto',
        })
        continue
      }

      const data = this.changedFields(current, c)
      if (Object.keys(data).length === 0) {
        unchanged++
        continue
      }
      updated++
      // A dry run only counts; it never builds the write.
      if (!input.dryRun) updateOps.push(this.db.performanceTrade.update({ where: { id: current.id }, data }))
    }

    if (!input.dryRun && (creates.length > 0 || updateOps.length > 0)) {
      await this.db.$transaction([
        ...(creates.length > 0 ? [this.db.performanceTrade.createMany({ data: creates })] : []),
        ...updateOps,
      ])
    }

    logger.info(
      { communityId, segment, dryRun: input.dryRun, created: creates.length, updated, errors: errors.length },
      'performance.import',
    )
    return {
      total: input.rows.length,
      created: creates.length,
      updated,
      unchanged,
      errors: errors.sort((a, b) => a.row - b.row),
      dryRun: input.dryRun,
    }
  }

  /** The columns an upload row would change on an existing trade. Cells the row leaves blank change nothing. */
  private changedFields(current: PerformanceTrade, c: Candidate): Prisma.PerformanceTradeUpdateInput {
    const data: Prisma.PerformanceTradeUpdateInput = {}
    if (c.name !== current.name) data.name = c.name
    if (c.symbol !== null && c.symbol !== current.symbol) data.symbol = c.symbol
    if (round2(c.entryPrice) !== round2(Number(current.entryPrice))) data.entryPrice = c.entryPrice
    if (c.exitPrice !== null && round2(c.exitPrice) !== round2(num(current.exitPrice) ?? NaN)) data.exitPrice = c.exitPrice
    if (c.charges != null && round2(c.charges) !== round2(num(current.charges) ?? NaN)) data.charges = c.charges
    if (c.cmp != null && round2(c.cmp) !== round2(num(current.cmp) ?? NaN)) data.cmp = c.cmp
    if (c.targetPct != null && round2(c.targetPct) !== round2(num(current.targetPct) ?? NaN)) data.targetPct = c.targetPct
    if (c.analysis != null && c.analysis !== current.analysis) data.analysis = c.analysis
    if (c.theme != null && c.theme !== current.theme) data.theme = c.theme
    if (c.exitDate != null && c.exitDate !== (current.exitDate === null ? null : isoDate(current.exitDate))) {
      data.exitDate = parseIsoDate(c.exitDate)
    }
    return data
  }

  // ─── Admin: period cards ──────────────────────────────────────────────────

  private assertPeriodBoard(board: PerformanceBoard, segment: PerformanceSegment): void {
    if (board.kind === 'intraday') throw new BadRequestError('Intraday boards have no period cards', 'NOT_SWING')
    if (isHoldingSegment(segment)) throw new BadRequestError('Long Term and US Investment have no period cards', 'NOT_SWING')
  }

  /** A segment cannot show the same from/to range twice; `excludeId` skips the period being edited. */
  private async assertPeriodUnique(
    boardId: string,
    segment: PerformanceSegment,
    fromMonth: Date,
    toMonth: Date,
    excludeId?: string,
  ): Promise<void> {
    const dupe = await this.db.performancePeriod.findFirst({
      where: { boardId, segment, fromMonth, toMonth, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })
    if (dupe) throw new ConflictError('This period already exists', 'PERIOD_EXISTS')
  }

  async createPeriod(
    accessible: string[] | null,
    communityId: string,
    input: { segment?: PerformanceSegment | undefined; name: string; fromMonth: string; toMonth: string; isDefault?: boolean | undefined },
  ): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    const segment = resolveSegment(board.kind, input.segment)
    this.assertPeriodBoard(board, segment)
    if (input.fromMonth > input.toMonth) throw new BadRequestError('The period cannot end before it starts', 'INVALID_PERIOD')

    const fromMonth = parseIsoMonth(input.fromMonth)
    const toMonth = parseIsoMonth(input.toMonth)
    await this.assertPeriodUnique(board.id, segment, fromMonth, toMonth)

    const count = await this.db.performancePeriod.count({ where: { boardId: board.id, segment } })
    if (count >= MAX_PERIODS_PER_SEGMENT) {
      throw new BadRequestError(`A segment can have at most ${MAX_PERIODS_PER_SEGMENT} periods`, 'TOO_MANY_PERIODS')
    }
    // The first card of a segment is its default whatever was asked, so the app always has one to open on. Asking for
    // another one moves the default to it.
    const isDefault = input.isDefault === true || count === 0
    return this.db.$transaction(async tx => {
      if (isDefault) await tx.performancePeriod.updateMany({ where: { boardId: board.id, segment, isDefault: true }, data: { isDefault: false } })
      return tx.performancePeriod.create({
        data: { boardId: board.id, segment, name: input.name, fromMonth, toMonth, isDefault },
        select: { id: true },
      })
    })
  }

  async updatePeriod(
    accessible: string[] | null,
    communityId: string,
    periodId: string,
    input: { name?: string | undefined; fromMonth?: string | undefined; toMonth?: string | undefined; isDefault?: boolean | undefined },
  ): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    const period = await this.db.performancePeriod.findFirst({ where: { id: periodId, boardId: board.id } })
    if (!period) throw new NotFoundError('Period not found')

    const from = input.fromMonth ?? isoMonth(period.fromMonth)
    const to = input.toMonth ?? isoMonth(period.toMonth)
    if (from > to) throw new BadRequestError('The period cannot end before it starts', 'INVALID_PERIOD')

    const fromMonth = parseIsoMonth(from)
    const toMonth = parseIsoMonth(to)
    await this.assertPeriodUnique(board.id, period.segment, fromMonth, toMonth, period.id)

    if (input.isDefault === false && period.isDefault) {
      throw new BadRequestError('Pick another period as the default instead', 'DEFAULT_REQUIRED')
    }

    await this.db.$transaction(async tx => {
      if (input.isDefault === true && !period.isDefault) {
        await tx.performancePeriod.updateMany({
          where: { boardId: board.id, segment: period.segment, isDefault: true },
          data: { isDefault: false },
        })
      }
      await tx.performancePeriod.update({
        where: { id: period.id },
        data: { fromMonth, toMonth, ...(input.name !== undefined && { name: input.name }), ...(input.isDefault === true && { isDefault: true }) },
      })
    })
    return { id: period.id }
  }

  async deletePeriod(accessible: string[] | null, communityId: string, periodId: string): Promise<void> {
    const board = await this.adminBoard(accessible, communityId)
    const period = await this.db.performancePeriod.findFirst({ where: { id: periodId, boardId: board.id } })
    if (!period) throw new NotFoundError('Period not found')

    await this.db.$transaction(async tx => {
      await tx.performancePeriod.delete({ where: { id: period.id } })
      // Removing the default hands it to the oldest card left, so the app still has one.
      if (period.isDefault) {
        const next = await tx.performancePeriod.findFirst({
          where: { boardId: board.id, segment: period.segment },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        })
        if (next) await tx.performancePeriod.update({ where: { id: next.id }, data: { isDefault: true } })
      }
    })
  }

  // ─── Mobile ───────────────────────────────────────────────────────────────

  /**
   * Whether the viewer is "paid" for a community, checked live. Admins who manage the community count as paid.
   * Everyone else is free unless they hold an active, unexpired subscription to it: this is the teaser screen,
   * so being free is never an error.
   */
  private async accessFor(
    user: { id: string; role: string; accessibleCommunityIds: string[] | null },
    communityId: string,
  ): Promise<'free' | 'paid'> {
    if (user.role === 'admin') return hasCommunityAccess(user.accessibleCommunityIds, communityId) ? 'paid' : 'free'
    return (await isPaidMemberOfCommunity(this.db, user.id, communityId)) ? 'paid' : 'free'
  }

  async listBoardsForMobile(user: { id: string; role: string; accessibleCommunityIds: string[] | null }): Promise<MobileBoardListDTO> {
    const boards = await this.db.performanceBoard.findMany({
      where: { community: { deletedAt: null } },
      include: { community: { select: { name: true, slug: true, deletedAt: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const paid = user.role === 'admin' ? null : await getPaidCommunityIds(this.db, user.id)

    return {
      boards: boards.map(b => ({
        communityId: b.communityId,
        name: b.community.name,
        slug: b.community.slug,
        kind: b.kind,
        segments: [...SEGMENTS_BY_KIND[b.kind]],
        access: (paid === null ? hasCommunityAccess(user.accessibleCommunityIds, b.communityId) : paid.has(b.communityId)) ? 'paid' : 'free',
      })),
    }
  }

  async getForMobile(
    user: { id: string; role: string; accessibleCommunityIds: string[] | null },
    communityId: string,
    q: MobileTradesQuery,
  ): Promise<MobilePerformanceDTO> {
    const board = await this.findBoard(communityId)
    const access = await this.accessFor(user, communityId)
    const segment = resolveSegment(board.kind, q.segment)
    const range = monthRangeOf(q)
    const trades = await this.segmentTrades(board.id, segment)

    const summary = await this.summarise(board, segment, trades, range)
    // The free rules (days, quota) are worked out over the whole segment, as the admin sees them; the months picked
    // then narrow what is shown and what is counted as held back.
    const visible = access === 'paid' ? null : freeVisibleIds(trades, rulesOf(board), todayIst())
    const inRange = range === null ? trades : trades.filter(t => inMonthRange(t.tradeDate, range))
    const hiddenCount = visible === null ? null : inRange.filter(t => !visible.has(t.id)).length

    const serials = new Map(trades.map((t, i) => [t.id, i + 1]))
    // S.N. order, the same as the admin: `trades` is already oldest first, and filtering keeps that order. The
    // cursor is the S.N. of the last row sent, so the next page starts right after it.
    let list = inRange.filter(t => visible === null || visible.has(t.id))
    if (q.cursor) {
      const after = decodeSerialCursor(q.cursor)
      list = list.filter(t => serials.get(t.id)! > after)
    }

    const page = list.slice(0, q.limit)
    const last = page[page.length - 1]
    const nextCursor = list.length > q.limit && last ? encodeSerialCursor(serials.get(last.id)!) : null

    const logos = await this.logosFor(page)
    const items = page.map(t => {
      const { serialNo: _serialNo, ...row } = this.toRow(board, segment, t, serials.get(t.id)!, logos)
      return row as MobileTradeRowDTO
    })

    return {
      communityId,
      communityName: board.community.name,
      kind: board.kind,
      access,
      segment,
      segments: [...SEGMENTS_BY_KIND[board.kind]],
      filter: range === null ? null : { fromMonth: range.from, toMonth: range.to },
      months: [...new Set(trades.map(t => isoMonth(t.tradeDate)))].sort().reverse(),
      summary,
      noteText: noteText(board),
      hiddenCount,
      items,
      nextCursor,
    }
  }
}
