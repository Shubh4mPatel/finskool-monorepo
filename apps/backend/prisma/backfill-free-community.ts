// One-off: creates the free community (Community.isFree = true) that every
// brand-new self-registered user is now auto-subscribed to at signup (see
// mobile-auth.service.ts#finalizeRegistration). seed.ts does this too, but
// only runs against a fresh dev database — an already-deployed environment
// needs this run once instead. Safe to re-run (idempotent — upsert by slug,
// no-ops if a free community already exists).
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

async function main() {
  const existing = await prisma.community.findFirst({ where: { isFree: true } })
  if (existing) {
    console.log(`[backfill-free-community] A free community already exists (${existing.id}, "${existing.name}") — nothing to do.`)
    return
  }

  // createdBy is a required FK to User — attribute it to the earliest-created
  // admin, same as any other community an admin "owns". If no admin exists
  // yet either, there's nothing sensible to attribute it to; skip rather than
  // guess, same as finalizeRegistration's own "no free community yet" fallback.
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.log('[backfill-free-community] No admin user exists yet — skipping. Run this again once one does.')
    return
  }

  const community = await prisma.community.upsert({
    where: { slug: 'free' },
    update: { isFree: true },
    create: {
      createdBy: admin.id,
      name: 'Free',
      slug: 'free',
      description: 'Default access granted automatically to every new member.',
      tags: [],
      isFree: true,
    },
  })
  console.log(`[backfill-free-community] Free community ready: ${community.id}`)
}

main()
  .catch((e) => { console.error('[backfill-free-community] Failed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
