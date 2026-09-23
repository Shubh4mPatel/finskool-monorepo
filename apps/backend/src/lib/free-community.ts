import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { SubscriptionSource } from './subscription-source.js'
import { recomputeActiveSubCount } from './community-stats.js'
import { logger } from '../shared/logger.js'

/**
 * Gives `userId` a subscription to the free community (Community.isFree) if
 * they don't have one yet. Idempotent, and never resurrects a row an admin
 * deliberately deactivated (any existing row counts). A missing free
 * community is not an error — the caller's own flow carries on, the user just
 * has no free access until one is seeded (see prisma/backfill-free-community.ts).
 */
export async function ensureFreeSubscription(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const free = await db.community.findFirst({
    where: { isFree: true, deletedAt: null },
    select: { id: true },
  })
  if (!free) {
    logger.warn({ userId }, 'ensureFreeSubscription: no free community exists — skipping')
    return
  }

  const existing = await db.subscription.findFirst({
    where: { userId, communityId: free.id },
    select: { id: true },
  })
  if (existing) return

  await db.subscription.create({
    data: {
      userId,
      communityId: free.id,
      payment: 0,
      paidOn: null,
      // validUntil is a required column with no "never expires"
      // representation — 100 years out is the free tier's way of
      // saying "doesn't really expire."
      validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 100)),
      source: SubscriptionSource.FreeSignup,
    },
  })
  await recomputeActiveSubCount(db, free.id)
}
