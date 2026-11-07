// One-time download of stock logos. For every active stock that has no logo it looks for one by two routes, stopping at the
// first that finds it:
//   1. the company's website (Finedge company profile) -> the logo for that website at logo.dev;
//   2. the company's ISIN (from NSE's public list of listed companies) -> the logo for that ISIN at logo.dev. An ISIN names
//      exactly one company, so this never returns another company's logo.
// It keeps a copy of the logo in our own storage (not hotlinked) and stores the copy's address in `stocks.logo_url`. Nothing
// else is written: no name, symbol, sector or price.
//
//   npm run db:download-stock-logos                          every stock that has no logo
//   npm run db:download-stock-logos -- --limit=20            a trial run on the first 20 (alphabetically)
//   npm run db:download-stock-logos -- --symbols=TCS,INFY    just these
//   npm run db:download-stock-logos -- --exchange=nse        only NSE stocks (BSE-only stocks seldom have a website or an ISIN on file)
//   npm run db:download-stock-logos -- --no-isin             the website route only
//   npm run db:download-stock-logos -- --logo-per-minute=80  how often logo.dev is asked (default 80, see below)
//
// Safe to run again: it only ever looks at stocks that still have no logo, so a run that was stopped carries on where it
// left off, and a stock that already has a logo is never touched. The exchange's test symbols (011NSETEST...) are skipped.
//
// Speed: logo.dev's free plan limits requests per minute and answers 429 beyond that; paid plans have no such limit. So logo.dev
// is asked at most 80 times a minute (raise it with --logo-per-minute on a paid plan), and if it says to slow down anyway the
// command waits, as long as logo.dev says or 15 to 60 seconds, and tries again. That makes the NSE stocks take about 40 minutes.
// The summary says how many logos each route found.
//
// If NSE's list cannot be downloaded (their site sometimes refuses servers) it says so and carries on with the website route.
//
// The stock list itself (name and symbol) comes from `npm run db:import-stocks`, or by itself the first time the backend
// starts with an empty stocks table. See docs/stock-logos.md.
//
// Self-contained: the production image ships prisma/ and src/generated but not the rest of src/, so this reads process.env
// directly and talks to MinIO itself, the same way prisma/seed.ts does.
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import * as Minio from 'minio'
import { randomUUID } from 'crypto'
import {
  DEFAULT_LOGO_REQUESTS_PER_MINUTE,
  createPacer,
  downloadStockLogos,
  parseNseList,
  publicUrlFor,
  requestPaced,
  type FetchedLogo,
  type ListedCompany,
  type LogoDeps,
} from './stock-logos-core.js'

const env = (name: string): string => process.env[name] ?? ''
const MAX_LOGO_BYTES = 1024 * 1024
const NSE_LIST_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'

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

const missing = ['DATABASE_URL', 'STOCK_QUOTE_API_BASE_URL', 'STOCK_QUOTE_API_KEY', 'LOGO_DEV_TOKEN', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'].filter(n => !env(n))
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
    () => fetch(`https://img.logo.dev/${path}?token=${env('LOGO_DEV_TOKEN')}&format=png&size=256&fallback=404`),
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

/** NSE's list of listed companies, with each one's ISIN. Null (with the reason printed) when it cannot be had. */
async function loadNseList(): Promise<Map<string, ListedCompany> | null> {
  try {
    const res = await fetch(NSE_LIST_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/csv,*/*' } })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return parseNseList(await res.text())
  } catch (err) {
    console.warn(`[download-stock-logos] Could not get NSE's list of ISINs (${err instanceof Error ? err.message : err}). Carrying on with the website route only.`)
    return null
  }
}

const nseList = flag('no-isin') ? null : await loadNseList()
if (nseList) console.log(`[download-stock-logos] NSE's list has an ISIN for ${nseList.size} companies`)

const deps: LogoDeps = {
  ...(nseList
    ? {
        findIsin: (symbol: string) => nseList.get(symbol.trim().toUpperCase())?.isin ?? null,
        fetchLogoByIsin: (isin: string) => logoDevImage(`isin/${isin}`),
      }
    : {}),

  async findWebsite(symbol) {
    const url = `${env('STOCK_QUOTE_API_BASE_URL')}/api/v1/company-profile/${encodeURIComponent(symbol)}?token=${env('STOCK_QUOTE_API_KEY')}`
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Finedge company-profile: ${res.status} ${res.statusText}`)
    const profile = (await res.json()) as { website?: string | null }
    return profile.website || null
  },

  fetchLogo: (domain): Promise<FetchedLogo | null> => logoDevImage(domain),

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
