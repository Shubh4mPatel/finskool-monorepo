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
import { decodeCursor, encodeCursor } from '../tickets/tickets.shared.js'
import {
  averageHoldingDays,
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
  isoDate,
  isoMonth,
  parseIsoDate,
  parseIsoMonth,
  resolveSegment,
  shortMonth,
} from './performance.shared.js'
import {
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
  cmp: number | null
  targetPct: number | null
  analysis: string | null
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
  cmp: number | null | undefined
  targetPct: number | null | undefined
  analysis: string | null | undefined
  exitDate: string | null | undefined
  visibility: TradeVisibility | undefined
}

const MAX_PERIODS_PER_SEGMENT = 20

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
    cmp: num(t.cmp),
    targetPct: num(t.targetPct),
    analysis: t.analysis,
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
const tradeSchemaFor = (kind: PerformanceKind) => (kind === 'intraday' ? intradayTradeSchema : swingTradeSchema)
const patchSchemaFor = (kind: PerformanceKind) => (kind === 'intraday' ? intradayPatchSchema : swingPatchSchema)

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

  private toRow(board: PerformanceBoard, t: TradeRow, serialNo: number): TradeRowDTO {
    const base = { id: t.id, serialNo, tradeDate: isoDate(t.tradeDate), name: t.name, entryPrice: t.entryPrice }
    if (board.kind === 'intraday') {
      const row: IntradayRowDTO = {
        ...base,
        side: t.side!,
        exitPrice: t.exitPrice!,
        ...intradayTrade({ side: t.side!, entryPrice: t.entryPrice, exitPrice: t.exitPrice! }, intradayParams(board)),
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

  /** Board-wide numbers, over every trade in the segment whoever is looking and whatever month is filtered. */
  private async summarise(board: PerformanceBoard, segment: PerformanceSegment, trades: TradeRow[]): Promise<SummaryDTO> {
    if (board.kind === 'intraday') {
      const params = intradayParams(board)
      const results = trades.map(t => intradayTrade({ side: t.side!, entryPrice: t.entryPrice, exitPrice: t.exitPrice! }, params))
      return { kind: 'intraday', ...intradaySummary(results, params) }
    }

    const kind = board.kind as 'swing' | 'investor'
    const results = trades.map(t =>
      swingTrade({ tradeDate: t.tradeDate, entryPrice: t.entryPrice, cmp: t.cmp, targetPct: t.targetPct, exitDate: t.exitDate }, kind),
    )
    const withStatus = trades.map((t, i) => ({ tradeDate: t.tradeDate, status: results[i]!.status }))
    const periods = await this.db.performancePeriod.findMany({
      where: { boardId: board.id, segment },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const periodDTOs: PeriodDTO[] = periods.map(p => ({
      id: p.id,
      segment: p.segment,
      fromMonth: isoMonth(p.fromMonth),
      toMonth: isoMonth(p.toMonth),
      label: `${shortMonth(p.fromMonth)} to ${shortMonth(p.toMonth)}`,
      ...periodStats(withStatus, p.fromMonth, p.toMonth),
    }))
    return { kind, averageHoldingDays: averageHoldingDays(results), totalTrades: trades.length, periods: periodDTOs }
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

    // S.N. counts over every trade in the segment, so a month view keeps the numbers the whole list would have.
    const numbered = trades.map((t, i) => ({ t, serialNo: i + 1 }))
    const filtered = q.month ? numbered.filter(n => isoMonth(n.t.tradeDate) === q.month) : numbered
    if (q.order === 'desc') filtered.reverse()

    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / q.pageSize))
    const items: AdminTradeRowDTO[] = filtered.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(({ t, serialNo }) => ({
      ...this.toRow(board, t, serialNo),
      visibility: t.visibility,
      visibleToFree: visible.has(t.id),
    }))

    return { items, total, page: q.page, pageSize: q.pageSize, totalPages, months }
  }

  /** A validated body into the stored fields, or a 400 explaining which date is wrong. */
  private toCandidate(kind: PerformanceKind, parsed: Record<string, unknown>): Candidate {
    const get = <T>(key: string): T | undefined => parsed[key] as T | undefined
    const candidate: Candidate = {
      tradeDate: get<string>('tradeDate')!,
      name: get<string>('name')!,
      symbol: kind === 'intraday' ? null : get<string>('symbol')!,
      side: kind === 'intraday' ? get<'buy' | 'sell'>('side')! : null,
      entryPrice: get<number>('entryPrice')!,
      exitPrice: kind === 'intraday' ? get<number>('exitPrice')! : null,
      cmp: kind === 'intraday' ? undefined : get<number | null>('cmp'),
      targetPct: kind === 'intraday' ? undefined : get<number | null>('targetPct'),
      analysis: kind === 'intraday' ? undefined : get<string | null>('analysis'),
      exitDate: kind === 'intraday' ? undefined : get<string | null>('exitDate'),
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
    const c = this.toCandidate(board.kind, tradeSchemaFor(board.kind).parse(body))

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
          cmp: c.cmp ?? null,
          targetPct: c.targetPct ?? null,
          analysis: c.analysis ?? null,
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

    const parsed = patchSchemaFor(board.kind).parse(body) as Record<string, unknown>
    const has = (key: string) => parsed[key] !== undefined

    // Merge over what is stored, so the date check and the trade key see the whole trade.
    const merged = this.toCandidate(board.kind, {
      tradeDate: has('tradeDate') ? parsed['tradeDate'] : isoDate(existing.tradeDate),
      name: has('name') ? parsed['name'] : existing.name,
      symbol: has('symbol') ? parsed['symbol'] : existing.symbol,
      side: has('side') ? parsed['side'] : existing.side,
      entryPrice: has('entryPrice') ? parsed['entryPrice'] : Number(existing.entryPrice),
      exitPrice: has('exitPrice') ? parsed['exitPrice'] : num(existing.exitPrice),
      cmp: has('cmp') ? parsed['cmp'] : num(existing.cmp),
      targetPct: has('targetPct') ? parsed['targetPct'] : num(existing.targetPct),
      analysis: has('analysis') ? parsed['analysis'] : existing.analysis,
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
          cmp: merged.cmp ?? null,
          targetPct: merged.targetPct ?? null,
          analysis: merged.analysis ?? null,
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
    const schema = tradeSchemaFor(board.kind)

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
        c = this.toCandidate(board.kind, result.data as Record<string, unknown>)
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
          cmp: c.cmp ?? null,
          targetPct: c.targetPct ?? null,
          analysis: c.analysis ?? null,
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
    if (c.cmp != null && round2(c.cmp) !== round2(num(current.cmp) ?? NaN)) data.cmp = c.cmp
    if (c.targetPct != null && round2(c.targetPct) !== round2(num(current.targetPct) ?? NaN)) data.targetPct = c.targetPct
    if (c.analysis != null && c.analysis !== current.analysis) data.analysis = c.analysis
    if (c.exitDate != null && c.exitDate !== (current.exitDate === null ? null : isoDate(current.exitDate))) {
      data.exitDate = parseIsoDate(c.exitDate)
    }
    return data
  }

  // ─── Admin: period cards ──────────────────────────────────────────────────

  private assertPeriodBoard(board: PerformanceBoard): void {
    if (board.kind === 'intraday') throw new BadRequestError('Intraday boards have no period cards', 'NOT_SWING')
  }

  async createPeriod(
    accessible: string[] | null,
    communityId: string,
    input: { segment?: PerformanceSegment | undefined; fromMonth: string; toMonth: string },
  ): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    this.assertPeriodBoard(board)
    const segment = resolveSegment(board.kind, input.segment)
    if (input.fromMonth > input.toMonth) throw new BadRequestError('The period cannot end before it starts', 'INVALID_PERIOD')

    const count = await this.db.performancePeriod.count({ where: { boardId: board.id, segment } })
    if (count >= MAX_PERIODS_PER_SEGMENT) {
      throw new BadRequestError(`A segment can have at most ${MAX_PERIODS_PER_SEGMENT} periods`, 'TOO_MANY_PERIODS')
    }
    return this.db.performancePeriod.create({
      data: { boardId: board.id, segment, fromMonth: parseIsoMonth(input.fromMonth), toMonth: parseIsoMonth(input.toMonth) },
      select: { id: true },
    })
  }

  async updatePeriod(
    accessible: string[] | null,
    communityId: string,
    periodId: string,
    input: { fromMonth?: string | undefined; toMonth?: string | undefined },
  ): Promise<{ id: string }> {
    const board = await this.adminBoard(accessible, communityId)
    const period = await this.db.performancePeriod.findFirst({ where: { id: periodId, boardId: board.id } })
    if (!period) throw new NotFoundError('Period not found')

    const from = input.fromMonth ?? isoMonth(period.fromMonth)
    const to = input.toMonth ?? isoMonth(period.toMonth)
    if (from > to) throw new BadRequestError('The period cannot end before it starts', 'INVALID_PERIOD')

    await this.db.performancePeriod.update({
      where: { id: period.id },
      data: { fromMonth: parseIsoMonth(from), toMonth: parseIsoMonth(to) },
    })
    return { id: period.id }
  }

  async deletePeriod(accessible: string[] | null, communityId: string, periodId: string): Promise<void> {
    const board = await this.adminBoard(accessible, communityId)
    const { count } = await this.db.performancePeriod.deleteMany({ where: { id: periodId, boardId: board.id } })
    if (count === 0) throw new NotFoundError('Period not found')
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
    const trades = await this.segmentTrades(board.id, segment)

    const summary = await this.summarise(board, segment, trades)
    const visible = access === 'paid' ? null : freeVisibleIds(trades, rulesOf(board), todayIst())
    const hiddenCount = visible === null ? null : trades.length - visible.size

    const serials = new Map(trades.map((t, i) => [t.id, i + 1]))
    let list = trades.filter(t => (visible === null || visible.has(t.id)) && (!q.month || isoMonth(t.tradeDate) === q.month))
    // Newest first by (date, id), the exact order the cursor walks.
    list = list.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))

    if (q.cursor) {
      const { at, id } = decodeCursor(q.cursor)
      list = list.filter(t => t.tradeDate.getTime() < at.getTime() || (t.tradeDate.getTime() === at.getTime() && t.id < id))
    }

    const page = list.slice(0, q.limit)
    const last = page[page.length - 1]
    const nextCursor = list.length > q.limit && last ? encodeCursor(last.tradeDate, last.id) : null

    const items = page.map(t => {
      const { serialNo: _serialNo, ...row } = this.toRow(board, t, serials.get(t.id)!)
      return row as MobileTradeRowDTO
    })

    return {
      communityId,
      communityName: board.community.name,
      kind: board.kind,
      access,
      segment,
      segments: [...SEGMENTS_BY_KIND[board.kind]],
      summary,
      noteText: noteText(board),
      hiddenCount,
      items,
      nextCursor,
    }
  }
}
