// One-time download of stock logos. For every active stock that has no logo it looks for one by two routes, stopping at the
// first that finds it:
//   1. the company's website (`stocks.website`, loaded from the stock sheet) -> the logo for that website at logo.dev;
//   2. the company's ISIN (`stocks.isin`, from the same sheet) -> the logo for that ISIN at logo.dev. An ISIN names exactly one
//      company, so this never returns another company's logo.
// It keeps a copy of the logo in our own storage (MinIO, not hotlinked) and stores the copy's address in `stocks.logo_url`.
// Nothing else is written: no name, symbol, sector or price.
//
// Load the stock sheet first (npm run db:load-stocks -- --apply): that is where the websites and ISINs come from. A stock without
// either (stocks that are not in the sheet) is reported as having no logo to be had.
//
//   npm run db:download-stock-logos                          every stock that has no logo
//   npm run db:download-stock-logos -- --limit=20            a trial run on the first 20 (alphabetically)
//   npm run db:download-stock-logos -- --symbols=TCS,INFY    just these
//   npm run db:download-stock-logos -- --exchange=nse        only stocks whose exchange is NSE
//   npm run db:download-stock-logos -- --no-isin             the website route only
//   npm run db:download-stock-logos -- --logo-per-minute=80  how often logo.dev is asked (default 80, see below)
//
// Safe to run again: it only ever looks at stocks that still have no logo, so a run that was stopped carries on where it
// left off, and a stock that already has a logo is never touched. The exchange's test symbols (011NSETEST...) are skipped.
//
// Speed: logo.dev's free plan limits requests per minute and answers 429 beyond that; paid plans have no such limit. So logo.dev
// is asked at most 80 times a minute (raise it with --logo-per-minute on a paid plan), and if it says to slow down anyway the
// command waits, as long as logo.dev says or 15 to 60 seconds, and tries again. The summary says how many logos each route found.
// The free plan also has a monthly allowance of requests and every request counts, "no logo" answers included: the start of the
// run says how many stocks are to be looked up, which is the least number of requests it will make.
//
// Self-contained: the production image ships prisma/ and src/generated but not the rest of src/, so this reads process.env
// directly and talks to MinIO itself, the same way prisma/seed.ts does.
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import * as Minio from 'minio'
import { randomUUID } from 'crypto'
import {
  DEFAULT_LOGO_REQUESTS_PER_MINUTE,
  TEST_SYMBOL_SUFFIX,
  createPacer,
  downloadStockLogos,
  extractDomain,
  publicUrlFor,
  requestPaced,
  type FetchedLogo,
  type LogoDeps,
} from './stock-logos-core.js'

const env = (name: string): string => process.env[name] ?? ''
const MAX_LOGO_BYTES = 1024 * 1024

function arg(name: string): string | undefined {
  return process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}
const flag = (name: string): boolean => process.argv.slice(2).includes(`--${name}`)

function fail(message: string): never {
  console.error(`[download-stock-logos] ${message}`)
  process.exit(1)
}

const limitArg = arg('limit')
const limit = limitArg === undefined ? undefined : Number(limitArg)
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail('--limit must be a whole number, for example --limit=20')
const symbols = arg('symbols')?.split(',')
const exchangeArg = arg('exchange')?.toLowerCase()
if (exchangeArg !== undefined && exchangeArg !== 'nse' && exchangeArg !== 'bse') fail('--exchange must be nse or bse')
const exchange = exchangeArg as 'nse' | 'bse' | undefined
const perMinuteArg = arg('logo-per-minute')
const logoPerMinute = perMinuteArg === undefined ? DEFAULT_LOGO_REQUESTS_PER_MINUTE : Number(perMinuteArg)
if (!Number.isFinite(logoPerMinute) || logoPerMinute < 1 || logoPerMinute > 6000) fail('--logo-per-minute must be a number from 1 to 6000, for example --logo-per-minute=80')

const missing = ['DATABASE_URL', 'LOGO_DEV_TOKEN', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'].filter(n => !env(n))
if (missing.length > 0) fail(`These are not set: ${missing.join(', ')}`)

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env('DATABASE_URL') }) })

const minio = new Minio.Client({
  endPoint: env('MINIO_ENDPOINT') || 'localhost',
  port: Number(env('MINIO_PORT') || 9000),
  useSSL: env('MINIO_USE_SSL') === 'true',
  accessKey: env('MINIO_ACCESS_KEY'),
  secretKey: env('MINIO_SECRET_KEY'),
})
const bucket = env('MINIO_BUCKET') || 'finskool'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
/** Every logo.dev request, whichever route it is for, goes through this, so together they stay under the per-minute limit. */
const pacer = createPacer({ minIntervalMs: Math.ceil(60_000 / logoPerMinute), sleep, now: Date.now })

/**
 * One logo from logo.dev, for a path such as `tatasteel.com` or `isin/INE081A01020`. `fallback=404`: without it logo.dev answers
 * something it has no logo for with a generated letter placeholder and a success status, which would be saved as if it were
 * the company's logo. PNG keeps the background transparent.
 */
async function logoDevImage(path: string): Promise<FetchedLogo | null> {
  const res = await requestPaced(
    // LOGO_DEV_BASE_URL is only for pointing a test at a stand-in server; leave it unset for the real thing.
    () => fetch(`${env('LOGO_DEV_BASE_URL') || 'https://img.logo.dev'}/${path}?token=${env('LOGO_DEV_TOKEN')}&format=png&size=256&fallback=404`),
    pacer,
    line => console.log(`[download-stock-logos] ${line}`),
  )
  if (res.status === 404 || res.status === 202) return null // no logo, or logo.dev has only just heard of this one
  if (!res.ok) throw new Error(`logo.dev: ${res.status} ${res.statusText}`)
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (!contentType.startsWith('image/')) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  return buffer.length === 0 || buffer.length > MAX_LOGO_BYTES ? null : { buffer, contentType }
}

/** What the sheet says of each stock that is still to get a logo: its website and its ISIN. */
const todo = await prisma.stock.findMany({
  where: { isActive: true, logoUrl: null, ...(exchange ? { exchange } : {}), NOT: { symbol: { endsWith: TEST_SYMBOL_SUFFIX } } },
  select: { symbol: true, website: true, isin: true },
})
const known = new Map(todo.map(s => [s.symbol, s]))

// How big the job is. Every stock with something to look up costs at least one logo.dev request ("no logo" answers count too),
// and a stock that the website route finds nothing for is asked again by its ISIN, so the real number is higher.
if (!limit && !symbols) {
  const withSite = todo.filter(s => s.website).length
  const onlyIsin = todo.filter(s => !s.website && s.isin).length
  const neither = todo.length - withSite - onlyIsin
  const requests = flag('no-isin') ? withSite : withSite + onlyIsin
  console.log(`[download-stock-logos] ${todo.length} stocks without a logo: ${withSite} with a website, ${onlyIsin} with only an ISIN, ${neither} with neither.`)
  console.log(`[download-stock-logos] At least ${requests} logo.dev requests, so at least ${Math.ceil(requests / logoPerMinute)} min at ${logoPerMinute} a minute. Check the usage in the logo.dev dashboard against your plan's monthly allowance.`)
}

// Companies of one group share a website, so several stocks can need the same logo: ask logo.dev for it once, even when the
// stocks are in the same batch (the request in flight is shared). Only a logo that was found is kept for the next stock, not a
// "none" or an error: logo.dev answers "none" the first time it hears of a domain and may have it later.
const domainCount = new Map<string, number>()
for (const s of todo) {
  if (!s.website) continue
  const domain = extractDomain(s.website).toLowerCase()
  domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1)
}
const logoByDomain = new Map<string, Promise<FetchedLogo | null>>()

const deps: LogoDeps = {
  ...(flag('no-isin')
    ? {}
    : {
        findIsin: (symbol: string) => known.get(symbol)?.isin ?? null,
        fetchLogoByIsin: (isin: string) => logoDevImage(`isin/${isin}`),
      }),

  async findWebsite(symbol) {
    return known.get(symbol)?.website ?? null
  },

  async fetchLogo(domain): Promise<FetchedLogo | null> {
    const key = domain.toLowerCase()
    if ((domainCount.get(key) ?? 0) < 2) return logoDevImage(domain)
    let pending = logoByDomain.get(key)
    if (!pending) {
      pending = logoDevImage(domain)
      logoByDomain.set(key, pending)
    }
    try {
      const logo = await pending
      if (!logo) logoByDomain.delete(key)
      return logo
    } catch (err) {
      logoByDomain.delete(key)
      throw err
    }
  },

  async storeLogo({ buffer, contentType }) {
    const objectName = `stock-logos/${randomUUID()}.png`
    await minio.putObject(bucket, objectName, buffer, buffer.length, { 'Content-Type': contentType })
    return publicUrlFor({
      ssl: env('MINIO_PUBLIC_USE_SSL') === 'true',
      host: env('MINIO_PUBLIC_ENDPOINT') || env('MINIO_ENDPOINT') || 'localhost',
      port: env('MINIO_PUBLIC_PORT') || env('MINIO_PORT') || 9000,
      // Same default as the app: behind nginx the files are under /assets; set MINIO_PUBLIC_PATH_PREFIX= (empty) when
      // browsers reach MinIO directly, as in local dev.
      pathPrefix: process.env['MINIO_PUBLIC_PATH_PREFIX'] ?? '/assets',
      bucket,
      objectName,
    })
  },

  pause: sleep,
}

async function main() {
  const started = Date.now()
  const result = await downloadStockLogos(prisma, deps, {
    ...(limit ? { limit } : {}),
    ...(symbols ? { symbols } : {}),
    ...(exchange ? { exchange } : {}),
    log: line => console.log(`[download-stock-logos] ${line}`),
  })

  const minutes = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`[download-stock-logos] Done in ${minutes} min. Looked at ${result.considered}: ${result.downloaded} logos downloaded, ${result.noLogo.length} with no logo to be had, ${result.failed.length} failed.`)
  console.log(`[download-stock-logos] Found by: website ${result.bySource.website}, ISIN ${result.bySource.isin}`)
  if (result.noLogo.length > 0) console.log(`[download-stock-logos] No logo to be had (${result.noLogo.length}): ${result.noLogo.slice(0, 100).join(', ')}${result.noLogo.length > 100 ? ', …' : ''}`)
  if (result.failed.length > 0) console.log(`[download-stock-logos] Failed, run it again to retry (${result.failed.length}): ${result.failed.slice(0, 100).join(', ')}${result.failed.length > 100 ? ', …' : ''}`)
  if (result.stoppedEarly) process.exitCode = 1
}

main()
  .catch(err => {
    console.error('[download-stock-logos] Failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
