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

/** What the download needs from the outside world, so tests can stand in for it. */
export interface LogoDeps {
  /** The company's website, or null when the profile API has no such company or no website for it. Throws when it could not be asked. */
  findWebsite(symbol: string): Promise<string | null>
  /** The logo for a domain, or null when logo.dev has none (yet). Throws when it could not be asked. */
  fetchLogo(domain: string): Promise<FetchedLogo | null>
  /** Keeps the file in our storage and returns its public address. */
  storeLogo(logo: FetchedLogo): Promise<string>
  pause(ms: number): Promise<void>
}

export interface DownloadOptions {
  /** Only this many stocks (for a trial run). */
  limit?: number
  /** Only these symbols. */
  symbols?: string[]
  log?: (line: string) => void
}

export interface DownloadResult {
  /** Stocks looked at. */
  considered: number
  downloaded: number
  /** Symbols with no logo to be had: no website on record, or none at logo.dev. */
  noLogo: string[]
  /** Symbols an API could not answer for just now; run again to retry them. */
  failed: string[]
  /** True when the run gave up because the APIs looked down. */
  stoppedEarly: boolean
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
    where: { isActive: true, logoUrl: null, ...(symbols && symbols.length > 0 ? { symbol: { in: symbols } } : {}) },
    orderBy: { symbol: 'asc' },
    ...(opts.limit ? { take: opts.limit } : {}),
    select: { id: true, symbol: true },
  })
  const result: DownloadResult = { considered: stocks.length, downloaded: 0, noLogo: [], failed: [], stoppedEarly: false }
  log(`${stocks.length} stock${stocks.length === 1 ? '' : 's'} without a logo`)

  const save = async (stock: { id: string; symbol: string }, logo: FetchedLogo) => {
    const logoUrl = await deps.storeLogo(logo)
    await db.stock.update({ where: { id: stock.id }, data: { logoUrl } })
    result.downloaded++
  }

  const again: { id: string; symbol: string; domain: string }[] = []
  let deadBatches = 0

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE)
    let failedInBatch = 0

    await Promise.all(
      batch.map(async stock => {
        try {
          const website = await deps.findWebsite(stock.symbol)
          const domain = website ? extractDomain(website) : null
          if (!domain) return void result.noLogo.push(stock.symbol)
          const logo = await deps.fetchLogo(domain)
          if (!logo) return void again.push({ ...stock, domain })
          await save(stock, logo)
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

  // A second look at the sites logo.dev had no logo for: it may only just have heard of them.
  if (again.length > 0 && !result.stoppedEarly) {
    log(`Looking again at ${again.length} site${again.length === 1 ? '' : 's'} logo.dev had no logo for yet`)
    await deps.pause(RETRY_PAUSE_MS)
    for (let i = 0; i < again.length; i += BATCH_SIZE) {
      const batch = again.slice(i, i + BATCH_SIZE)
      await Promise.all(
        batch.map(async stock => {
          try {
            const logo = await deps.fetchLogo(stock.domain)
            if (logo) await save(stock, logo)
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
