import type { PrismaClient, Prisma } from '../generated/prisma/client.js'
import { ForbiddenError } from '../shared/errors/index.js'

type Db = PrismaClient | Prisma.TransactionClient

export const COMMUNITY_BLOCKED_CODE = 'COMMUNITY_BLOCKED'

/**
 * Notification rows this member may see: everything except what belongs to a community they are blocked from.
 * Rows with no community (service requests) always pass. Written as an explicit OR because a plain "not in" would
 * also drop the rows whose community is null.
 */
export function visibleNotifications(userId: string): Prisma.NotificationWhereInput {
  return { OR: [{ communityId: null }, { community: { blocks: { none: { userId } } } }] }
}

/** The block on a member's access to one community, or null if there is none. */
export async function findCommunityBlock(db: Db, userId: string, communityId: string) {
  return db.communityBlock.findUnique({ where: { uq_community_block: { userId, communityId } } })
}

/** Every community an admin has blocked this member from. */
export async function getBlockedCommunityIds(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db.communityBlock.findMany({ where: { userId }, select: { communityId: true } })
  return new Set(rows.map(r => r.communityId))
}

/**
 * Refuses to give a blocked member any new access to the community (a purchase, a renewal, an admin extending or
 * re-adding them). `audience` only changes the wording: the member is told why, an admin is told to unblock first.
 */
export async function assertNotBlocked(
  db: Db,
  userId: string,
  communityId: string,
  audience: 'member' | 'admin' = 'admin',
): Promise<void> {
  const block = await db.communityBlock.findUnique({
    where: { uq_community_block: { userId, communityId } },
    include: { community: { select: { name: true } } },
  })
  if (!block) return
  throw new ForbiddenError(
    audience === 'member'
      ? blockedMessage(block.community.name, block.reason)
      : 'This member is suspended from this community. Revoke the suspension first.',
    COMMUNITY_BLOCKED_CODE,
  )
}

/** What a blocked member is told wherever they try to use the community: where, why, and who to ask. */
export function blockedMessage(communityName: string, reason: string): string {
  return `You have been suspended from ${communityName}. Reason: ${reason}. Please contact the admin.`
}
