// One-time download of stock logos. For every active stock that has no logo it finds the company's website (Finedge company
// profile), fetches the logo for that website from logo.dev, keeps a copy in our own storage (not hotlinked) and stores the
// copy's address in `stocks.logo_url`. Nothing else is written: no name, symbol, sector or price.
//
//   npm run db:download-stock-logos                          every stock that has no logo
//   npm run db:download-stock-logos -- --limit=20            a trial run on the first 20 (alphabetically)
//   npm run db:download-stock-logos -- --symbols=TCS,INFY    just these
//
// Safe to run again: it only ever looks at stocks that still have no logo, so a run that was stopped carries on where it
// left off, and a stock that already has a logo is never touched. It takes about 20 minutes for a full list of stocks (five a
// second, the Finedge limit).
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
import { downloadStockLogos, publicUrlFor, type FetchedLogo, type LogoDeps } from './stock-logos-core.js'

const env = (name: string): string => process.env[name] ?? ''
const MAX_LOGO_BYTES = 1024 * 1024

function arg(name: string): string | undefined {
  return process.argv.slice(2).find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function fail(message: string): never {
  console.error(`[download-stock-logos] ${message}`)
  process.exit(1)
}

const limitArg = arg('limit')
const limit = limitArg === undefined ? undefined : Number(limitArg)
if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) fail('--limit must be a whole number, for example --limit=20')
const symbols = arg('symbols')?.split(',')

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

const deps: LogoDeps = {
  async findWebsite(symbol) {
    const url = `${env('STOCK_QUOTE_API_BASE_URL')}/api/v1/company-profile/${encodeURIComponent(symbol)}?token=${env('STOCK_QUOTE_API_KEY')}`
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Finedge company-profile: ${res.status} ${res.statusText}`)
    const profile = (await res.json()) as { website?: string | null }
    return profile.website || null
  },

  async fetchLogo(domain): Promise<FetchedLogo | null> {
    // `fallback=404`: without it logo.dev answers an unknown domain with a generated letter placeholder and a success status,
    // which would be saved as if it were the company's logo. PNG keeps the background transparent.
    const res = await fetch(`https://img.logo.dev/${domain}?token=${env('LOGO_DEV_TOKEN')}&format=png&size=256&fallback=404`)
    if (res.status === 404 || res.status === 202) return null // no logo, or logo.dev has only just heard of this domain
    if (!res.ok) throw new Error(`logo.dev: ${res.status} ${res.statusText}`)
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (!contentType.startsWith('image/')) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return buffer.length === 0 || buffer.length > MAX_LOGO_BYTES ? null : { buffer, contentType }
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

  pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

async function main() {
  const started = Date.now()
  const result = await downloadStockLogos(prisma, deps, { ...(limit ? { limit } : {}), ...(symbols ? { symbols } : {}), log: line => console.log(`[download-stock-logos] ${line}`) })

  const minutes = ((Date.now() - started) / 60000).toFixed(1)
  console.log(`[download-stock-logos] Done in ${minutes} min. Looked at ${result.considered}: ${result.downloaded} logos downloaded, ${result.noLogo.length} with no logo to be had, ${result.failed.length} failed.`)
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
