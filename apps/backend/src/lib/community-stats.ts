import type { Prisma } from '../generated/prisma/client.js'

/**
 * Recompute-from-scratch, same self-healing pattern as
 * ReactionsService#recomputeReactionCounts — grouped by userId (not a plain
 * count) so a user with more than one active row for the same community
 * (e.g. an un-deactivated renewal) is only counted once. Must run inside the
 * same transaction as the write that changed isActive/validUntil.
 */
export async function recomputeActiveSubCount(tx: Prisma.TransactionClient, communityId: string): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const rows = await tx.subscription.groupBy({
    by: ['userId'],
    where: { communityId, isActive: true, validUntil: { gte: today } },
  })
  const count = rows.length

  await tx.community.update({ where: { id: communityId }, data: { activeSubCount: count } })
  return count
}
