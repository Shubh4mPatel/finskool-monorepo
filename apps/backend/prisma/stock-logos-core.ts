// The logic of the one-time stock logo download (prisma/download-stock-logos.ts), kept apart from the command-line wiring
// so it can be tested without calling any API.
//
// Self-contained on purpose: the production image ships prisma/ and src/generated (the Prisma client) but not the rest of
// src/, so this may import only the generated Prisma types.
//
// What it does, and all it does: for every active stock that has no logo, find the company's website, fetch the logo for
// that website, keep a copy in our own storage and store the copy's address in `stocks.logo_url`. Nothing else on the
// stock is touched: not its name or symbol, not any price or sector.

import type { PrismaClient } from '../src/generated/prisma/client.js'

/** Five stocks at a time with a pause: under Finedge's limit of 300 requests a minute. */
export const BATCH_SIZE = 5
export const BATCH_PAUSE_MS = 1000
/** logo.dev answers "202" (and, asked for a 404, a 404) the first time it hears of a domain, so such a domain gets a second look. */
export const RETRY_PAUSE_MS = 5000
/** Stop when this many batches in a row failed completely: that is an outage of an API, not bad stocks. */
export const MAX_DEAD_BATCHES = 3

export interface FetchedLogo {
  buffer: Buffer
  contentType: string
}

/**
 * What the download needs from the outside world, so tests can stand in for it.
 *
 * A stock's logo is looked for by two routes, in this order, stopping at the first that finds one:
 *   1. its website (Finedge) -> the logo for that website;
 *   2. its ISIN, the official identifier of the company -> the logo for that ISIN. An ISIN names exactly one company, so this
 *      cannot return another company's logo the way a search by name could. Both ISIN steps are optional; without them only
 *      the website route is used.
 */
export interface LogoDeps {
  /** The company's website, or null when the profile API has no such company or no website for it. Throws when it could not be asked. */
  findWebsite(symbol: string): Promise<string | null>
  /** The logo for a domain, or null when logo.dev has none (yet). Throws when it could not be asked. */
  fetchLogo(domain: string): Promise<FetchedLogo | null>
  /** The stock's official ISIN, or null when it is not known. Works from a list already in memory, so it does not wait. */
  findIsin?(symbol: string): string | null
  /** The logo for an ISIN, or null when logo.dev has none (yet). Throws when it could not be asked. */
  fetchLogoByIsin?(isin: string): Promise<FetchedLogo | null>
  /** Keeps the file in our storage and returns its public address. */
  storeLogo(logo: FetchedLogo): Promise<string>
  pause(ms: number): Promise<void>
}

export type LogoSource = 'website' | 'isin'

export interface DownloadOptions {
  /** Only this many stocks (for a trial run). */
  limit?: number
  /** Only these symbols. */
  symbols?: string[]
  /** Only stocks on this exchange. */
  exchange?: 'nse' | 'bse'
  log?: (line: string) => void
}

export interface DownloadResult {
  /** Stocks looked at. */
  considered: number
  downloaded: number
  /** How many of the downloaded logos each route found. */
  bySource: Record<LogoSource, number>
  /** Symbols with no logo to be had: no website and no known ISIN, or neither found one at logo.dev. */
  noLogo: string[]
  /** Symbols an API could not answer for just now; run again to retry them. */
  failed: string[]
  /** True when the run gave up because the APIs looked down. */
  stoppedEarly: boolean
}

/** What NSE's public list says about one listed company. */
export interface ListedCompany {
  name: string
  isin: string
}

/** Splits CSV text into rows of fields, honouring quoted fields (which may hold commas, quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

const ISIN_FORMAT = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/

/**
 * NSE's list of listed companies (EQUITY_L.csv) as a map from trading symbol to company name and ISIN. Columns are found by
 * their heading (NSE pads some headings with spaces), and a row with no valid ISIN is skipped. Throws if the list is not in
 * the expected shape, so a changed or error page is noticed rather than read as "no company has an ISIN".
 */
export function parseNseList(csv: string): Map<string, ListedCompany> {
  const rows = parseCsv(csv.replace(/^﻿/, ''))
  const header = (rows[0] ?? []).map(h => h.trim().toUpperCase())
  const symbolAt = header.indexOf('SYMBOL')
  const isinAt = header.indexOf('ISIN NUMBER')
  const nameAt = header.indexOf('NAME OF COMPANY')
  if (symbolAt === -1 || isinAt === -1) throw new Error('The NSE list is not in the expected format (no SYMBOL or ISIN NUMBER column)')

  const companies = new Map<string, ListedCompany>()
  for (const row of rows.slice(1)) {
    const symbol = (row[symbolAt] ?? '').trim().toUpperCase()
    const isin = (row[isinAt] ?? '').trim().toUpperCase()
    if (symbol && ISIN_FORMAT.test(isin) && !companies.has(symbol)) {
      companies.set(symbol, { name: nameAt === -1 ? '' : (row[nameAt] ?? '').trim(), isin })
    }
  }
  return companies
}

/** "https://www.tatasteel.com/investors" -> "tatasteel.com" */
export function extractDomain(website: string): string {
  return website.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0] ?? website
}

/**
 * The address a stored file is served at, the same rule the app uses for every upload (`toPublicUrl` in src/lib/minio.ts):
 * behind nginx the path prefix is "/assets"; with browsers reaching MinIO directly (local dev) it is empty.
 */
export function publicUrlFor(o: { ssl: boolean; host: string; port: number | string; pathPrefix: string; bucket: string; objectName: string }): string {
  return `${o.ssl ? 'https' : 'http'}://${o.host}:${o.port}${o.pathPrefix}/${o.bucket}/${o.objectName}`
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function downloadStockLogos(db: PrismaClient, deps: LogoDeps, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const log = opts.log ?? (() => {})
  const symbols = opts.symbols?.map(s => s.trim().toUpperCase()).filter(Boolean)
  const stocks = await db.stock.findMany({
    where: {
      isActive: true,
      logoUrl: null,
      ...(symbols && symbols.length > 0 ? { symbol: { in: symbols } } : {}),
      ...(opts.exchange ? { exchange: opts.exchange } : {}),
    },
    orderBy: { symbol: 'asc' },
    ...(opts.limit ? { take: opts.limit } : {}),
    select: { id: true, symbol: true },
  })
  const result: DownloadResult = { considered: stocks.length, downloaded: 0, bySource: { website: 0, isin: 0 }, noLogo: [], failed: [], stoppedEarly: false }
  log(`${stocks.length} stock${stocks.length === 1 ? '' : 's'} without a logo`)

  const save = async (stock: { id: string; symbol: string }, logo: FetchedLogo, source: LogoSource) => {
    const logoUrl = await deps.storeLogo(logo)
    await db.stock.update({ where: { id: stock.id }, data: { logoUrl } })
    result.downloaded++
    result.bySource[source]++
  }

  /** Looks for a stock's logo by each route it has, in order. Null when none had one (yet). */
  const find = async (target: { domain: string | null; isin: string | null }): Promise<{ logo: FetchedLogo; source: LogoSource } | null> => {
    if (target.domain) {
      const logo = await deps.fetchLogo(target.domain)
      if (logo) return { logo, source: 'website' }
    }
    if (target.isin && deps.fetchLogoByIsin) {
      const logo = await deps.fetchLogoByIsin(target.isin)
      if (logo) return { logo, source: 'isin' }
    }
    return null
  }

  // Stocks neither route found a logo for yet, though one had something to look up: logo.dev may only just have heard of
  // them (it answers "not yet" the first time it sees a domain), so they get a second look after a pause.
  const again: { id: string; symbol: string; domain: string | null; isin: string | null }[] = []
  let deadBatches = 0

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE)
    let failedInBatch = 0

    await Promise.all(
      batch.map(async stock => {
        try {
          const website = await deps.findWebsite(stock.symbol)
          const target = { domain: website ? extractDomain(website) || null : null, isin: deps.findIsin?.(stock.symbol) ?? null }
          if (!target.domain && !target.isin) return void result.noLogo.push(stock.symbol)
          const found = await find(target)
          if (!found) return void again.push({ ...stock, ...target })
          await save(stock, found.logo, found.source)
        } catch (err) {
          result.failed.push(stock.symbol)
          failedInBatch++
          log(`${stock.symbol}: ${message(err)}`)
        }
      }),
    )

    const done = Math.min(i + BATCH_SIZE, stocks.length)
    if (Math.floor(i / BATCH_SIZE) % 10 === 9 || done === stocks.length) log(`${done}/${stocks.length} done, ${result.downloaded} logos downloaded`)

    deadBatches = failedInBatch === batch.length ? deadBatches + 1 : 0
    if (deadBatches >= MAX_DEAD_BATCHES) {
      result.stoppedEarly = true
      log('Every stock in the last batches failed, so an API looks down. Stopping: run it again later and it carries on where it left off.')
      break
    }
    if (done < stocks.length) await deps.pause(BATCH_PAUSE_MS)
  }

  // The second look.
  if (again.length > 0 && !result.stoppedEarly) {
    log(`Looking again at ${again.length} stock${again.length === 1 ? '' : 's'} logo.dev had no logo for yet`)
    await deps.pause(RETRY_PAUSE_MS)
    for (let i = 0; i < again.length; i += BATCH_SIZE) {
      const batch = again.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async stock => {
          try {
            const found = await find(stock)
            if (found) await save(stock, found.logo, found.source)
            else result.noLogo.push(stock.symbol)
          } catch (err) {
            result.failed.push(stock.symbol)
            log(`${stock.symbol}: ${message(err)}`)
          }
        }),
      )
      if (i + BATCH_SIZE < again.length) await deps.pause(BATCH_PAUSE_MS)
    }
  }

  return result
}
