import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import * as Minio from 'minio'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

const minioClient = new Minio.Client({
  endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: Number(process.env['MINIO_PORT'] ?? 9000),
  useSSL: process.env['MINIO_USE_SSL'] === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'] ?? '',
  secretKey: process.env['MINIO_SECRET_KEY'] ?? '',
})

const bucket = process.env['MINIO_BUCKET'] ?? 'finskool'

async function uploadSeedImage(filename: string): Promise<string> {
  const buffer = readFileSync(join(__dirname, 'seed-assets', filename))
  const objectName = `communities/${randomUUID()}.png`
  await minioClient.putObject(bucket, objectName, buffer, buffer.length, {
    'Content-Type': 'image/png',
  })
  const protocol = process.env['MINIO_USE_SSL'] === 'true' ? 'https' : 'http'
  const publicEndpoint = process.env['MINIO_PUBLIC_ENDPOINT'] ?? process.env['MINIO_ENDPOINT'] ?? 'localhost'
  const port = process.env['MINIO_PUBLIC_PORT'] ?? process.env['MINIO_PORT'] ?? '9000'
  return `${protocol}://${publicEndpoint}:${port}/${bucket}/${objectName}`
}

async function main() {
  const passwordHash = await bcrypt.hash('Admin@123', 10)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@finskool.com' },
    update: {},
    create: {
      name: 'Finskool Admin',
      email: 'admin@finskool.com',
      phone: '+910000000000',
      passwordHash,
      role: 'admin',
    },
  })

  console.log(`[seed] Admin user: ${admin.id}`)

  const swingAlphaUrl = await uploadSeedImage('swing-alpha.png')
  const investorUrl = await uploadSeedImage('investor-community.png')

  const swingAlphaTags = ['Trade Alerts', 'Swing Calls', 'Live Updates']
  const investorTags = ['Research', 'Portfolio', 'Long-term']

  const swingAlpha = await prisma.community.upsert({
    where: { slug: 'swing-alpha' },
    update: { coverImageUrl: swingAlphaUrl, tags: swingAlphaTags },
    create: {
      createdBy: admin.id,
      name: 'Swing Alpha',
      slug: 'swing-alpha',
      description: 'Short to medium-term trade calls, breakout plays, and momentum stocks.',
      tags: swingAlphaTags,
      coverImageUrl: swingAlphaUrl,
    },
  })

  const investorCommunity = await prisma.community.upsert({
    where: { slug: 'investor-community' },
    update: { coverImageUrl: investorUrl, tags: investorTags },
    create: {
      createdBy: admin.id,
      name: 'Investor Community',
      slug: 'investor-community',
      description: 'Long-term fundamental investing, value picks, and multi-year wealth building ideas.',
      tags: investorTags,
      coverImageUrl: investorUrl,
    },
  })

  for (const community of [swingAlpha, investorCommunity]) {
    await prisma.communityMember.upsert({
      where: { uq_community_member: { communityId: community.id, userId: admin.id } },
      update: {},
      create: {
        communityId: community.id,
        userId: admin.id,
        role: 'moderator',
      },
    })
    console.log(`[seed] Community ready: ${community.name}`)
  }

  // Tokens resolved from AngelOne's published scrip master
  // (OpenAPIScripMaster.json), matched on exch_seg "NSE" + the equity
  // segment (instrumenttype "") entry whose `name` equals our symbol.
  const stocksSeedData: { name: string; symbol: string; sector: string; token: string | null }[] = [
    { name: 'Tata Steel Ltd', symbol: 'TATASTEEL', sector: 'Metals', token: '3499' },
    { name: 'Adani Power Ltd', symbol: 'ADANIPOWER', sector: 'Energy', token: '17388' },
    { name: 'Infosys Ltd', symbol: 'INFY', sector: 'IT', token: '1594' },
    // No "TATAMOTORS" entry exists in the scrip master anymore — Tata Motors
    // demerged its passenger-vehicle business, which now trades separately.
    // "TMPV" (token 3456) is the best-guess successor by name but is UNCONFIRMED —
    // verify against AngelOne's docs/support before relying on this for live prices.
    { name: 'Tata Motors Ltd', symbol: 'TATAMOTORS', sector: 'Auto', token: '3456' },
    { name: 'ITC Ltd', symbol: 'ITC', sector: 'FMCG', token: '1660' },
    { name: 'Wipro Ltd', symbol: 'WIPRO', sector: 'IT', token: '3787' },
    { name: 'Bajaj Finance Ltd', symbol: 'BAJFINANCE', sector: 'NBFC', token: '317' },
  ]

  for (const s of stocksSeedData) {
    await prisma.stock.upsert({
      where: { symbol: s.symbol },
      update: { name: s.name, sector: s.sector, token: s.token },
      create: { name: s.name, symbol: s.symbol, sector: s.sector, token: s.token },
    })
  }
  console.log(`[seed] Stocks ready: ${stocksSeedData.length}`)
}

main()
  .catch((e) => { console.error('[seed] Failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
