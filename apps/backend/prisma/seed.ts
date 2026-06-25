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
  const endpoint = process.env['MINIO_ENDPOINT'] ?? 'localhost'
  const port = process.env['MINIO_PORT'] ?? '9000'
  return `${protocol}://${endpoint}:${port}/${bucket}/${objectName}`
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

  const swingAlpha = await prisma.community.upsert({
    where: { slug: 'swing-alpha' },
    update: {},
    create: {
      createdBy: admin.id,
      name: 'Swing Alpha',
      slug: 'swing-alpha',
      description: 'Short to medium-term trade calls, breakout plays, and momentum stocks.',
      coverImageUrl: swingAlphaUrl,
    },
  })

  const investorCommunity = await prisma.community.upsert({
    where: { slug: 'investor-community' },
    update: {},
    create: {
      createdBy: admin.id,
      name: 'Investor Community',
      slug: 'investor-community',
      description: 'Long-term fundamental investing, value picks, and multi-year wealth building ideas.',
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
}

main()
  .catch((e) => { console.error('[seed] Failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
