// One-off: computes and persists ApprovedPhone.status for every existing member, using the
// same precedence the app used to re-derive on every read (see src/lib/member-status.ts).
// Needed because the `status` column was added with a blanket DEFAULT 'pending', so every
// existing row needs its real status backfilled once. Run once via `npm run db:backfill-member-status`;
// safe to re-run (idempotent — recomputes and overwrites regardless of current value).
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import { computeMemberStatus } from '../src/lib/member-status.js'

const connectionString = process.env['DATABASE_URL']
if (!connectionString) throw new Error('DATABASE_URL is not set')

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
})

async function main() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const approvedPhones = await prisma.approvedPhone.findMany({
    select: { id: true, phone: true, isActive: true, isRegistered: true, status: true },
  })

  const users = await prisma.user.findMany({
    where: { phone: { in: approvedPhones.map(ap => ap.phone) } },
    select: { phone: true, isActive: true },
  })
  const userByPhone = new Map(users.map(u => [u.phone, u]))

  // Ordered newest-first so the first entry seen per approvedPhoneId is the "current" one —
  // same "most recently created row" notion used throughout admin.service.ts.
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { createdAt: 'desc' },
    select: { approvedPhoneId: true, isActive: true, validUntil: true },
  })
  const currentSubByApprovedPhoneId = new Map<string, { isActive: boolean; validUntil: Date }>()
  for (const sub of subscriptions) {
    if (!currentSubByApprovedPhoneId.has(sub.approvedPhoneId)) {
      currentSubByApprovedPhoneId.set(sub.approvedPhoneId, { isActive: sub.isActive, validUntil: sub.validUntil })
    }
  }

  let updated = 0
  for (const ap of approvedPhones) {
    const user = userByPhone.get(ap.phone)
    const nextStatus = computeMemberStatus({
      approvedPhoneActive: ap.isActive,
      registered: ap.isRegistered,
      suspended: user ? !user.isActive : false,
      currentSubscription: currentSubByApprovedPhoneId.get(ap.id) ?? null,
      today,
    })
    if (nextStatus !== ap.status) {
      await prisma.approvedPhone.update({ where: { id: ap.id }, data: { status: nextStatus } })
      updated++
    }
  }
  console.log(`approved_phones: ${updated}/${approvedPhones.length} rows updated`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
