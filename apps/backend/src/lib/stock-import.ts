// Bulk-imports the NSE + BSE equity universe from AngelOne's public scrip
// master into the `stocks` table. Shared by:
// - `ensureStocksSeeded`, called once at server boot (src/index.ts) — a no-op
//   if the table already has rows, so restarts don't re-fetch/re-import.
// - `prisma/import-stocks.ts`, a manual standalone script for forcing a
//   re-import (e.g. after improving the filtering heuristics below).
//
// Strategy (confirmed with the user):
// - NSE is authoritative: every entry with exch_seg "NSE" and a symbol ending in
//   "-EQ" (the reliable marker for ordinary listed common stock on NSE — plain
//   `instrumenttype: ""` also matches government securities, mutual fund units,
//   sovereign gold bonds etc., which "-EQ" excludes. Note "-EQ" also includes
//   some listed ETFs and NCDs that trade on NSE's equity segment — the feed
//   doesn't distinguish these from ordinary common stock any further).
// - BSE only fills gaps: a BSE entry is imported only if no NSE entry shares its
//   `name` (i.e. the company isn't already covered via the more liquid NSE listing).
// - BSE has no equivalent "-EQ" marker, so its non-equity noise (G-Secs, NCDs,
//   commercial paper, corporate deposits, index rows) is filtered heuristically:
//   index-range tokens, digit-leading names, "GS<digits>" G-Secs, SGB/SDL prefixes,
//   and names ending in a 4+ digit run (typical of bond/NCD maturity-style codes).
//   This is best-effort — a small number of stray non-equity codes may still slip
//   through. Deactivate (`isActive: false`) any spotted in the admin search dropdown.
// - `sector` has no source in this data at all and is left `null` for every
//   bulk-imported row — only hand-curated stocks (see prisma/seed.ts) have a
//   real sector until sector data is sourced separately.

import type { PrismaClient } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
const CHUNK_SIZE = 1000

interface ScripEntry {
  token: string
  symbol: string
  name: string
  exch_seg: string
  instrumenttype: string
}

interface StockRow {
  name: string
  symbol: string
  sector: null
  token: string
}

function isLikelyNonEquity(entry: ScripEntry): boolean {
  const name = entry.name
  if (/^999/.test(entry.token)) return true // index rows (e.g. SENSEX, BANKEX, sub-indices)
  if (/^[0-9]/.test(name)) return true // digit-leading: SDL/G-Sec/rights-style codes
  if (/^GS[0-9]/i.test(name)) return true // G-Secs (e.g. GS15DEC39C)
  if (/^SGB/i.test(name) || /^SDL/i.test(name)) return true // sovereign gold bonds / state dev loans
  if (/\d{4,}$/.test(name)) return true // NCD/commercial-paper maturity-style trailing digits
  return false
}

async function fetchStockRows(): Promise<StockRow[]> {
  logger.info({ url: SCRIP_MASTER_URL }, 'stock-import: fetching AngelOne scrip master')
  const res = await fetch(SCRIP_MASTER_URL)
  if (!res.ok) throw new Error(`Failed to fetch scrip master: HTTP ${res.status}`)
  const data = (await res.json()) as ScripEntry[]
  logger.info({ total: data.length }, 'stock-import: fetched scrip master')

  const nseEquities = data.filter(d => d.exch_seg === 'NSE' && d.symbol.endsWith('-EQ'))
  const nseNames = new Set(nseEquities.map(d => d.name))

  const bseGapFill = data.filter(
    d => d.exch_seg === 'BSE' && !nseNames.has(d.name) && !isLikelyNonEquity(d),
  )

  logger.info(
    { nseEquities: nseEquities.length, bseGapFill: bseGapFill.length },
    'stock-import: filtered candidates',
  )

  const rows: StockRow[] = [...nseEquities, ...bseGapFill].map(d => ({
    name: d.name,
    symbol: d.name,
    sector: null,
    token: d.token,
  }))

  // De-dupe by symbol (our unique key) in case the source data has stray
  // repeats — keep the first occurrence, which favors the NSE entry since
  // nseEquities is spread first.
  const bySymbol = new Map<string, StockRow>()
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row)
  }
  return [...bySymbol.values()]
}

/** Fetches + inserts the full NSE/BSE equity universe. Existing symbols (e.g. hand-curated stocks) are left untouched. */
export async function importStocks(db: PrismaClient): Promise<number> {
  const rows = await fetchStockRows()
  let created = 0
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const result = await db.stock.createMany({ data: chunk, skipDuplicates: true })
    created += result.count
  }
  return created
}

/** Runs `importStocks` only if the table is currently empty — safe to call on every server boot. */
export async function ensureStocksSeeded(db: PrismaClient): Promise<void> {
  const existing = await db.stock.count()
  if (existing > 0) {
    logger.info({ existing }, 'stock-import: stocks table already populated — skipping automatic import')
    return
  }

  logger.info('stock-import: stocks table empty — running automatic NSE/BSE import')
  const created = await importStocks(db)
  logger.info({ created }, 'stock-import: automatic NSE/BSE import complete')
}
