// The logic of loading the stock sheet (prisma/seed-assets/India_NSE_BSE_Equity_Stocks.xlsx) into the `stocks` table
// (prisma/load-stocks-from-sheet.ts), kept apart from the command-line wiring so it can be tested without a spreadsheet.
//
// Self-contained on purpose: the production image ships prisma/ and src/generated (the Prisma client) but not the rest of
// src/, so this may import only the generated Prisma types.
//
// What it does: makes the `stocks` table match the sheet. It does NOT empty the table and refill it, because three things
// hang off a stock row and would be lost:
//   - `token`, `cmp`, `close_price`: the live-price feed subscribes by `token`, which the sheet does not have;
//   - `logo_url`: logos already downloaded;
//   - `id`: stock recommendations point at a stock by id.
// So a stock that is in the sheet is matched to its existing row (by ISIN, else by symbol) and updated in place, a stock that is
// new is created, and a stock that is not in the sheet any more is deleted, or just switched off when a recommendation
// refers to it. The end state is the sheet.

import type { PrismaClient, Stock } from '../src/generated/prisma/client.js'

export const SHEET_NAME = 'Stocks'

/** The headings the sheet must have, exactly. */
export const REQUIRED_COLUMNS = [
  'ISIN',
  'Company Name',
  'NSE Symbol',
  'BSE Code',
  'BSE Symbol',
  'Listed On',
  'NSE Board',
  'NSE Series',
  'Sector',
  'Industry',
  'Website',
  'NSE Listing Date',
  'Face Value (₹)',
] as const

export type Listing = 'nse_bse' | 'nse' | 'bse'

const LISTING: Record<string, Listing> = { 'NSE & BSE': 'nse_bse', 'NSE ONLY': 'nse', 'BSE ONLY': 'bse' }

/** The longest each text may be: the width of its column in `stocks`. */
const MAX_LEN = { name: 150, symbol: 50, sector: 100, industry: 100, website: 255, bseCode: 10, bseSymbol: 50, nseBoard: 30, nseSeries: 10 } as const

const ISIN_FORMAT = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

/** One company of the sheet, cleaned up and ready for the `stocks` table. */
export interface SheetStock {
  isin: string
  name: string
  /** What the app calls the stock: the NSE symbol, else the BSE symbol, else (when that is taken by another company) the BSE code. */
  symbol: string
  /** The exchange the live-price token resolves against: NSE whenever the company is on NSE. */
  exchange: 'nse' | 'bse'
  listedOn: Listing
  bseCode: string | null
  bseSymbol: string | null
  nseBoard: string | null
  nseSeries: string | null
  sector: string | null
  industry: string | null
  website: string | null
  nseListingDate: Date | null
  /** Two decimals, as text. */
  faceValue: string | null
}

export interface ParsedSheet {
  stocks: SheetStock[]
  /** Rows that could not be used, so their stock is NOT in `stocks`. Loading with these would delete those stocks, so the command refuses to apply until they are fixed. */
  problems: string[]
  /** Things noticed that did not stop a row from being used (an unreadable date, a symbol replaced by the BSE code). */
  warnings: string[]
}

type Cell = unknown

/** A cell as trimmed text; null when it is empty. Numbers (the sheet stores BSE codes as numbers) become text. */
function text(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null
  const s = String(cell).trim()
  return s === '' ? null : s
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/**
 * A listing date from what a cell holds: an Excel serial number (what the sheet has), a Date, "06-Oct-2008" or "2008-10-06".
 * Null when it cannot be read. The result is midnight UTC, which is what a `date` column keeps.
 */
export function parseSheetDate(cell: Cell): Date | null {
  if (cell === null || cell === undefined || cell === '') return null
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : new Date(Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate()))
  if (typeof cell === 'number') {
    // Excel counts days from 1899-12-30; 25569 of them are before 1970-01-01.
    if (!Number.isFinite(cell) || cell < 1 || cell > 80_000) return null
    return new Date(Math.floor(cell - 25569) * 86_400_000)
  }
  const s = String(cell).trim()
  const dmy = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})$/.exec(s)
  if (dmy) {
    const month = MONTHS[dmy[2]!.toLowerCase()]
    if (month === undefined) return null
    const d = new Date(Date.UTC(Number(dmy[3]), month, Number(dmy[1])))
    return d.getUTCMonth() === month ? d : null
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])))
    return d.getUTCMonth() === Number(iso[2]) - 1 ? d : null
  }
  return null
}

function parseFaceValue(cell: Cell): string | null {
  const s = text(cell)
  if (s === null) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 && n < 1e8 ? n.toFixed(2) : null
}

/**
 * Turns the rows of the "Stocks" sheet (heading -> cell) into stocks. Throws when a heading is missing, so a sheet in another shape
 * is noticed rather than read as "no company has a website". A row that cannot be used is reported in `problems` and left out.
 *
 * The symbol: the NSE symbol when the company is on NSE. A BSE-only company has no NSE symbol, so it gets its BSE symbol. Seven
 * BSE-only companies in the current sheet have a BSE symbol that another company already uses as its NSE symbol (FOCUS, ZEAL...),
 * and the symbol must be unique, so those get their BSE code instead (a number, unique to them). The result is deterministic:
 * the same sheet always gives the same symbols, which is what lets a second run match the rows the first one made.
 */
export function parseStockSheet(rows: Record<string, Cell>[]): ParsedSheet {
  if (rows.length === 0) throw new Error('The sheet has no rows')
  const headings = new Set(Object.keys(rows[0]!))
  const missing = REQUIRED_COLUMNS.filter(h => !headings.has(h))
  if (missing.length > 0) throw new Error(`The sheet has no column ${missing.map(m => `"${m}"`).join(', ')}`)

  const problems: string[] = []
  const warnings: string[] = []

  interface Draft extends Omit<SheetStock, 'symbol'> {
    nseSymbol: string | null
    row: number
  }
  const drafts: Draft[] = []
  const seenIsin = new Set<string>()

  rows.forEach((raw, i) => {
    const row = i + 2 // row 1 is the headings
    const fail = (why: string) => void problems.push(`row ${row}: ${why}`)

    const isin = text(raw['ISIN'])?.toUpperCase() ?? ''
    if (!ISIN_FORMAT.test(isin)) return fail(`"${isin}" is not an ISIN`)
    if (seenIsin.has(isin)) return fail(`ISIN ${isin} is in the sheet twice`)
    const label = `row ${row} (${isin})`

    const name = text(raw['Company Name'])
    if (!name) return fail(`${isin} has no company name`)

    const listedOn = LISTING[(text(raw['Listed On']) ?? '').toUpperCase()]
    if (!listedOn) return fail(`${isin} has "Listed On" = "${text(raw['Listed On']) ?? ''}", expected NSE & BSE, NSE only or BSE only`)

    const nseSymbol = text(raw['NSE Symbol'])?.toUpperCase() ?? null
    const bseSymbol = text(raw['BSE Symbol'])?.toUpperCase() ?? null
    const bseCode = text(raw['BSE Code'])
    if (listedOn !== 'bse' && !nseSymbol) return fail(`${isin} is listed on NSE but has no NSE symbol`)
    if (listedOn === 'bse' && !bseSymbol && !bseCode) return fail(`${isin} is BSE only but has neither a BSE symbol nor a BSE code`)

    const fields = {
      name,
      sector: text(raw['Sector']),
      industry: text(raw['Industry']),
      website: text(raw['Website']),
      bseCode,
      bseSymbol,
      nseBoard: text(raw['NSE Board']),
      nseSeries: text(raw['NSE Series']),
    }
    for (const [field, value] of Object.entries(fields)) {
      const max = MAX_LEN[field as keyof typeof MAX_LEN]
      if (value !== null && value.length > max) return fail(`${isin}: ${field} is ${value.length} characters, the most the database keeps is ${max}`)
    }

    const listingCell = raw['NSE Listing Date']
    const nseListingDate = parseSheetDate(listingCell)
    if (nseListingDate === null && text(listingCell) !== null) warnings.push(`${label}: listing date "${text(listingCell)}" could not be read, left empty`)
    const faceCell = raw['Face Value (₹)']
    const faceValue = parseFaceValue(faceCell)
    if (faceValue === null && text(faceCell) !== null) warnings.push(`${label}: face value "${text(faceCell)}" could not be read, left empty`)

    seenIsin.add(isin)
    drafts.push({ ...fields, isin, nseSymbol, listedOn, exchange: listedOn === 'bse' ? 'bse' : 'nse', nseListingDate, faceValue, row })
  })

  // Symbols. NSE symbols first: they are what the app and the Performance trades already use.
  const taken = new Map<string, Draft>()
  const stocks: SheetStock[] = []
  const place = (d: Draft, symbol: string): boolean => {
    if (symbol.length > MAX_LEN.symbol) {
      problems.push(`row ${d.row}: symbol "${symbol}" is longer than ${MAX_LEN.symbol} characters`)
      return false
    }
    const other = taken.get(symbol)
    if (other) {
      problems.push(`row ${d.row}: symbol ${symbol} is also used by ${other.isin} (row ${other.row})`)
      return false
    }
    taken.set(symbol, d)
    stocks.push({
      isin: d.isin, name: d.name, symbol, exchange: d.exchange, listedOn: d.listedOn, bseCode: d.bseCode, bseSymbol: d.bseSymbol,
      nseBoard: d.nseBoard, nseSeries: d.nseSeries, sector: d.sector, industry: d.industry, website: d.website,
      nseListingDate: d.nseListingDate, faceValue: d.faceValue,
    })
    return true
  }

  for (const d of drafts) if (d.nseSymbol) place(d, d.nseSymbol)

  const bseOnly = drafts.filter(d => !d.nseSymbol)
  const wanted = new Map<string, number>()
  for (const d of bseOnly) if (d.bseSymbol) wanted.set(d.bseSymbol, (wanted.get(d.bseSymbol) ?? 0) + 1)
  for (const d of bseOnly) {
    const preferred = d.bseSymbol
    const clash = preferred !== null && (taken.has(preferred) || (wanted.get(preferred) ?? 0) > 1)
    if (preferred !== null && !clash) {
      place(d, preferred)
    } else if (d.bseCode) {
      if (place(d, d.bseCode) && preferred !== null) warnings.push(`row ${d.row} (${d.isin}, ${d.name}): BSE symbol ${preferred} is used by another company, so its symbol is the BSE code ${d.bseCode}`)
    } else {
      problems.push(`row ${d.row} (${d.isin}): symbol ${preferred ?? '?'} is taken and there is no BSE code to use instead`)
    }
  }

  stocks.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return { stocks, problems, warnings }
}

// ─── Comparing the sheet with the table ──────────────────────────────────────

/** What the plan needs to know of a row already in the table. */
export type ExistingStock = Pick<
  Stock,
  | 'id'
  | 'symbol'
  | 'name'
  | 'sector'
  | 'logoUrl'
  | 'token'
  | 'exchange'
  | 'isActive'
  | 'isin'
  | 'bseCode'
  | 'bseSymbol'
  | 'listedOn'
  | 'nseBoard'
  | 'nseSeries'
  | 'industry'
  | 'website'
  | 'nseListingDate'
  | 'faceValue'
>

export type StockChanges = Partial<{
  name: string
  symbol: string
  sector: string | null
  exchange: 'nse' | 'bse'
  isActive: boolean
  isin: string
  bseCode: string | null
  bseSymbol: string | null
  listedOn: Listing
  nseBoard: string | null
  nseSeries: string | null
  industry: string | null
  website: string | null
  nseListingDate: Date | null
  faceValue: string | null
  logoUrl: null
}>

export interface LoadPlan {
  create: SheetStock[]
  update: { id: string; symbol: string; changes: StockChanges }[]
  unchanged: number
  /** In the table, not in the sheet, and nothing refers to them: deleted. */
  remove: { id: string; symbol: string }[]
  /** In the table, not in the sheet, but a stock recommendation refers to them: kept, switched off. */
  deactivate: { id: string; symbol: string }[]
  /** Not in the sheet, referred to, and already switched off: left as they are. */
  keptInactive: number
  /** How many existing logos are cleared (only with resetLogos). */
  logosCleared: number
  /** Reasons the plan cannot be applied. */
  conflicts: string[]
}

const sameDay = (a: Date | null, b: Date | null): boolean => (a === null || b === null ? a === b : a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10))
const sameNumber = (a: unknown, b: string | null): boolean => (a === null || a === undefined || b === null ? (a ?? null) === b : Number(a) === Number(b))

/** What has to change on an existing row to match the sheet. Empty when it already does. */
function diff(e: ExistingStock, s: SheetStock, resetLogos: boolean): StockChanges {
  const c: StockChanges = {}
  if (e.name !== s.name) c.name = s.name
  if (e.symbol !== s.symbol) c.symbol = s.symbol
  // The sheet fills a blank sector but never erases one (a few stocks have a hand-curated sector).
  if (s.sector !== null && e.sector !== s.sector) c.sector = s.sector
  // A row with a live-price token keeps the exchange that token belongs to; changing it would subscribe the token to the wrong exchange.
  if (!(e.token && e.exchange) && e.exchange !== s.exchange) c.exchange = s.exchange
  if (!e.isActive) c.isActive = true
  if (e.isin !== s.isin) c.isin = s.isin
  if ((e.bseCode ?? null) !== s.bseCode) c.bseCode = s.bseCode
  if ((e.bseSymbol ?? null) !== s.bseSymbol) c.bseSymbol = s.bseSymbol
  if ((e.listedOn ?? null) !== s.listedOn) c.listedOn = s.listedOn
  if ((e.nseBoard ?? null) !== s.nseBoard) c.nseBoard = s.nseBoard
  if ((e.nseSeries ?? null) !== s.nseSeries) c.nseSeries = s.nseSeries
  if ((e.industry ?? null) !== s.industry) c.industry = s.industry
  if ((e.website ?? null) !== s.website) c.website = s.website
  if (!sameDay(e.nseListingDate ?? null, s.nseListingDate)) c.nseListingDate = s.nseListingDate
  if (!sameNumber(e.faceValue, s.faceValue)) c.faceValue = s.faceValue
  if (resetLogos && e.logoUrl) c.logoUrl = null
  return c
}

/**
 * Works out what loading the sheet would do, without doing it. `referencedIds` are the stocks a recommendation points at.
 *
 * A sheet stock is matched to the existing row with its ISIN, else to the one with its symbol. A row found by symbol whose ISIN is a
 * different company's is NOT a match (the symbol was reused): that row is treated as gone, and the sheet's company gets a new one.
 * `conflicts` lists what cannot be applied safely (a symbol that would end up on two rows); it is empty for the normal first load.
 */
export function planLoad(existing: ExistingStock[], referencedIds: Set<string>, sheet: SheetStock[], opts: { resetLogos?: boolean } = {}): LoadPlan {
  const key = (symbol: string) => symbol.toUpperCase()
  const byIsin = new Map<string, ExistingStock>()
  const bySymbol = new Map<string, ExistingStock>()
  for (const e of existing) {
    if (e.isin && !byIsin.has(e.isin)) byIsin.set(e.isin, e)
    if (!bySymbol.has(key(e.symbol))) bySymbol.set(key(e.symbol), e)
  }

  const plan: LoadPlan = { create: [], update: [], unchanged: 0, remove: [], deactivate: [], keptInactive: 0, logosCleared: 0, conflicts: [] }
  const claimed = new Set<string>()
  const matched: { e: ExistingStock; s: SheetStock }[] = []

  for (const s of sheet) {
    let e = byIsin.get(s.isin)
    if (!e) {
      const bySym = bySymbol.get(key(s.symbol))
      if (bySym && (!bySym.isin || bySym.isin === s.isin)) e = bySym
    }
    if (e && !claimed.has(e.id)) {
      claimed.add(e.id)
      matched.push({ e, s })
    } else {
      plan.create.push(s)
    }
  }

  for (const { e, s } of matched) {
    const changes = diff(e, s, opts.resetLogos === true)
    if (Object.keys(changes).length === 0) plan.unchanged++
    else {
      plan.update.push({ id: e.id, symbol: s.symbol, changes })
      if (changes.logoUrl === null) plan.logosCleared++
    }
  }

  for (const e of existing) {
    if (claimed.has(e.id)) continue
    if (!referencedIds.has(e.id)) plan.remove.push({ id: e.id, symbol: e.symbol })
    else if (e.isActive) plan.deactivate.push({ id: e.id, symbol: e.symbol })
    else plan.keptInactive++
  }

  // A symbol may end up on one row only. Rows being deleted free theirs, and so do rows that are being renamed; every other
  // row (unchanged, updated in place, or switched off) keeps the symbol it has.
  const removed = new Set(plan.remove.map(r => r.id))
  const renamed = new Map(plan.update.filter(u => u.changes.symbol !== undefined).map(u => [u.id, u.changes.symbol!]))
  const holder = new Map<string, string>() // symbol -> id of the row that will hold it
  for (const e of existing) if (!removed.has(e.id) && !renamed.has(e.id)) holder.set(key(e.symbol), e.id)
  const wanted = [...renamed].map(([id, symbol]) => ({ id, symbol, label: `stock ${id}` })).concat(plan.create.map(s => ({ id: `new:${s.isin}`, symbol: s.symbol, label: `new stock ${s.isin}` })))
  for (const w of wanted) {
    const current = holder.get(key(w.symbol))
    if (current !== undefined && current !== w.id) {
      const who = current.startsWith('new:') ? `new stock ${current.slice(4)}` : referencedIds.has(current) ? `stock ${current}, which a recommendation refers to and which is not in the sheet` : `stock ${current}`
      plan.conflicts.push(`symbol ${w.symbol} would be on two stocks: ${w.label} and ${who}`)
    } else holder.set(key(w.symbol), w.id)
  }

  return plan
}

// ─── Doing it ────────────────────────────────────────────────────────────────

export interface LoadResult {
  plan: LoadPlan
  applied: boolean
  /** Symbols on a Performance trade that are being removed or switched off: those trades lose their logo. */
  tradesLosingStock: string[]
}

const CHUNK = 1000

/**
 * Compares the sheet with the table and, when `apply` is true, makes the table match it in one transaction (all or nothing).
 * Without `apply` it only reports. Throws, writing nothing, when the plan has conflicts or the sheet is empty.
 */
export async function loadStocksFromSheet(db: PrismaClient, sheet: SheetStock[], opts: { apply: boolean; resetLogos?: boolean; log?: (line: string) => void }): Promise<LoadResult> {
  const log = opts.log ?? (() => {})
  // An empty sheet would delete every stock.
  if (sheet.length === 0) throw new Error('The sheet has no usable stocks, so nothing is loaded')

  const existing = await db.stock.findMany({
    select: {
      id: true, symbol: true, name: true, sector: true, logoUrl: true, token: true, exchange: true, isActive: true, isin: true, bseCode: true,
      bseSymbol: true, listedOn: true, nseBoard: true, nseSeries: true, industry: true, website: true, nseListingDate: true, faceValue: true,
    },
  })
  const referenced = await db.stockRecommendation.findMany({ select: { stockId: true }, distinct: ['stockId'] })
  const plan = planLoad(existing, new Set(referenced.map(r => r.stockId)), sheet, { resetLogos: opts.resetLogos === true })
  if (plan.conflicts.length > 0) throw new Error(`Cannot load the sheet:\n  ${plan.conflicts.join('\n  ')}`)

  // A Performance trade finds its stock by symbol, so a stock that goes away takes its logo off those trades.
  const gone = new Set([...plan.remove, ...plan.deactivate].map(r => r.symbol.toUpperCase()))
  const tradeSymbols = await db.$queryRaw<{ symbol: string }[]>`SELECT DISTINCT upper(symbol) AS symbol FROM performance_trades WHERE symbol IS NOT NULL`
  const tradesLosingStock = tradeSymbols.map(t => t.symbol).filter(s => gone.has(s)).sort()

  if (!opts.apply) return { plan, applied: false, tradesLosingStock }

  await db.$transaction(
    async tx => {
      // Deletes first: they free symbols and ISINs the rest may want.
      for (let i = 0; i < plan.remove.length; i += CHUNK) {
        await tx.stock.deleteMany({ where: { id: { in: plan.remove.slice(i, i + CHUNK).map(r => r.id) } } })
      }
      for (let i = 0; i < plan.deactivate.length; i += CHUNK) {
        await tx.stock.updateMany({ where: { id: { in: plan.deactivate.slice(i, i + CHUNK).map(r => r.id) } }, data: { isActive: false } })
      }
      log(`removed ${plan.remove.length}, switched off ${plan.deactivate.length}`)
      for (const [n, u] of plan.update.entries()) {
        await tx.stock.update({ where: { id: u.id }, data: u.changes })
        if ((n + 1) % 1000 === 0) log(`updated ${n + 1}/${plan.update.length}`)
      }
      log(`updated ${plan.update.length}`)
      for (let i = 0; i < plan.create.length; i += CHUNK) {
        await tx.stock.createMany({ data: plan.create.slice(i, i + CHUNK).map(s => ({ ...s, isActive: true })) })
      }
      log(`created ${plan.create.length}`)
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  )
  return { plan, applied: true, tradesLosingStock }
}
