// One-off: enriches every Stock row missing `sector` or `logoUrl` by calling the Finedge
// company-profile API per symbol, then downloading and storing the company's logo.dev logo
// in MinIO (not hotlinked). Run once via `npm run db:enrich-stock-profiles`; safe to re-run —
// only touches stocks still missing sector or logoUrl, so a re-run after new stocks are
// imported (see import-stocks.ts) only processes the new ones.
//
// Self-contained: this runs via tsx as a standalone prisma/ script, and the production Docker
// image only ships dist/ (compiled) + src/generated (Prisma client) into the runtime container,
// not the rest of src/ — so this can only import from src/generated/prisma/client.js. It reads
// process.env directly and duplicates the small amount of MinIO-upload logic inline, the same
// way prisma/seed.ts already does for its own image uploads.
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import * as Minio from 'minio'
import { randomUUID } from 'crypto'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const STOCK_QUOTE_API_BASE_URL = process.env['STOCK_QUOTE_API_BASE_URL'] ?? ''
const STOCK_QUOTE_API_KEY = process.env['STOCK_QUOTE_API_KEY'] ?? ''
const LOGO_DEV_TOKEN = process.env['LOGO_DEV_TOKEN'] ?? ''

const minioClient = new Minio.Client({
  endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: Number(process.env['MINIO_PORT'] ?? 9000),
  useSSL: process.env['MINIO_USE_SSL'] === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'] ?? '',
  secretKey: process.env['MINIO_SECRET_KEY'] ?? '',
})
const bucket = process.env['MINIO_BUCKET'] ?? 'finskool'

const BATCH_SIZE = 5 // stays under Finedge's 300 req/min (5 req/sec) rate limit — see lib/stock-quote-api.ts
const BATCH_PAUSE_MS = 1000

interface CompanyProfile {
  sector?: string | null
  website?: string | null
  [key: string]: unknown
}

async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile> {
  const url = `${STOCK_QUOTE_API_BASE_URL}/api/v1/company-profile/${encodeURIComponent(symbol)}?token=${STOCK_QUOTE_API_KEY}`
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`Finedge company-profile ${symbol}: ${res.status} ${res.statusText}`)
  return (await res.json()) as CompanyProfile
}

function extractDomain(website: string): string {
  return website
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0] ?? website
}

function buildLogoUrl(website: string | null | undefined): string | null {
  if (!website) return null
  const domain = extractDomain(website)
  return `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}`
}

async function fetchLogo(logoUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const res = await fetch(logoUrl)
  if (!res.ok) return null
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType: res.headers.get('content-type') ?? 'image/png' }
}

async function uploadLogo(buffer: Buffer, contentType: string): Promise<string> {
  const ext = contentType.split('/').pop() ?? 'png'
  const objectName = `stock-logos/${randomUUID()}.${ext}`
  await minioClient.putObject(bucket, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  })
  const protocol = process.env['MINIO_PUBLIC_USE_SSL'] === 'true' ? 'https' : 'http'
  const publicEndpoint = process.env['MINIO_PUBLIC_ENDPOINT'] ?? process.env['MINIO_ENDPOINT'] ?? 'localhost'
  const port = process.env['MINIO_PUBLIC_PORT'] ?? process.env['MINIO_PORT'] ?? '9000'
  // Same "/assets" prefix nginx expects — see the toPublicUrl comment in src/lib/minio.ts.
  return `${protocol}://${publicEndpoint}:${port}/assets/${bucket}/${objectName}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  if (!STOCK_QUOTE_API_BASE_URL || !STOCK_QUOTE_API_KEY) {
    throw new Error('STOCK_QUOTE_API_BASE_URL / STOCK_QUOTE_API_KEY are not set')
  }

  const stocks = await prisma.stock.findMany({
    where: { isActive: true, OR: [{ sector: null }, { logoUrl: null }] },
    select: { id: true, symbol: true },
  })

  let updated = 0
  let failed = 0

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async stock => {
      try {
        const profile = await fetchCompanyProfile(stock.symbol)

        let logoUrl: string | null = null
        const logoDevUrl = buildLogoUrl(profile.website)
        if (logoDevUrl) {
          const logo = await fetchLogo(logoDevUrl)
          if (logo) logoUrl = await uploadLogo(logo.buffer, logo.contentType)
        }

        const data: { sector?: string; logoUrl?: string } = {}
        if (profile.sector) data.sector = profile.sector
        if (logoUrl) data.logoUrl = logoUrl

        if (Object.keys(data).length > 0) {
          await prisma.stock.update({ where: { id: stock.id }, data })
          updated++
        }
      } catch (err) {
        failed++
        console.error(`[enrich-stock-profiles] ${stock.symbol}: failed —`, err)
      }
    }))

    if (i + BATCH_SIZE < stocks.length) await sleep(BATCH_PAUSE_MS)
  }

  console.log(`[enrich-stock-profiles] Done. total=${stocks.length} updated=${updated} failed=${failed}`)
}

main()
  .catch(err => {
    console.error('[enrich-stock-profiles] Failed:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
