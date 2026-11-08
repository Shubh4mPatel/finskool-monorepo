import type { PrismaClient } from '../generated/prisma/client.js'
import { ForbiddenError } from '../shared/errors/index.js'
import { notExpired } from './subscription-expiry.js'

export async function isSuperAdmin(db: PrismaClient, adminId: string): Promise<boolean> {
  const admin = await db.user.findUnique({ where: { id: adminId }, select: { isSuperAdmin: true } })
  return admin?.isSuperAdmin ?? false
}

/** null = unrestricted (super admin); string[] = exact granted set (possibly empty) */
export async function getAccessibleCommunityIds(db: PrismaClient, adminId: string): Promise<string[] | null> {
  if (await isSuperAdmin(db, adminId)) return null
  const rows = await db.communityAdmin.findMany({ where: { adminId }, select: { communityId: true } })
  return rows.map(r => r.communityId)
}

/** All admins who should be notified about activity in a community: every
 *  super admin (unrestricted — mirrors getAccessibleCommunityIds' null-means-
 *  unrestricted convention) plus every admin explicitly granted access to
 *  this specific community via CommunityAdmin. */
export async function getCommunityAdminIds(db: PrismaClient, communityId: string): Promise<string[]> {
  const admins = await db.user.findMany({
    where: {
      role: 'admin',
      deletedAt: null,
      OR: [
        { isSuperAdmin: true },
        { communityAccess: { some: { communityId } } },
      ],
    },
    select: { id: true },
  })
  return admins.map(a => a.id)
}

/** Every active admin account. Services are global, so every admin sees every service request. */
export async function getAllAdminIds(db: PrismaClient): Promise<string[]> {
  const admins = await db.user.findMany({ where: { role: 'admin', deletedAt: null }, select: { id: true } })
  return admins.map(a => a.id)
}

/**
 * Admins who can open a member's profile: super admins, plus admins who manage a community the member
 * subscribes to (the same rule as hasMemberAccess). Use it to tell admins about a member, so nobody is sent
 * a notification for a page they would be refused.
 */
export async function getAdminIdsWithMemberAccess(db: PrismaClient, userId: string): Promise<string[]> {
  const subs = await db.subscription.findMany({ where: { userId }, select: { communityId: true } })
  const communityIds = [...new Set(subs.map(s => s.communityId))]
  const admins = await db.user.findMany({
    where: {
      role: 'admin',
      deletedAt: null,
      OR: [{ isSuperAdmin: true }, ...(communityIds.length ? [{ communityAccess: { some: { communityId: { in: communityIds } } } }] : [])],
    },
    select: { id: true },
  })
  return admins.map(a => a.id)
}

export async function assertCommunityAccess(db: PrismaClient, adminId: string, communityId: string): Promise<void> {
  if (await isSuperAdmin(db, adminId)) return
  const access = await db.communityAdmin.findUnique({
    where: { uq_community_admin: { communityId, adminId } },
  })
  if (!access) {
    throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
  }
}

/** Synchronous, token-based equivalent of getAccessibleCommunityIds — reads the
 *  JWT-derived accessibleCommunityIds instead of hitting the DB. */
export function hasCommunityAccess(accessibleCommunityIds: string[] | null, communityId: string): boolean {
  return accessibleCommunityIds === null || accessibleCommunityIds.includes(communityId)
}

/** Synchronous, token-based equivalent of assertCommunityAccess — no DB round-trip. */
export function assertCommunityAccessFromToken(
  accessibleCommunityIds: string[] | null,
  communityId: string,
): void {
  if (!hasCommunityAccess(accessibleCommunityIds, communityId)) {
    throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
  }
}

/** Whether an admin may act on a specific member. A member isn't owned by any one
 *  community, so "access" mirrors what GET /admin/members already shows a scoped
 *  admin: the member has (or had) a subscription row in a community they manage.
 *  null = unrestricted (super admin). Members with no subscriptions at all are
 *  therefore super-admin only, same as in the roster. */
export async function hasMemberAccess(
  db: PrismaClient,
  accessibleCommunityIds: string[] | null,
  userId: string,
): Promise<boolean> {
  if (accessibleCommunityIds === null) return true
  if (accessibleCommunityIds.length === 0) return false
  const sub = await db.subscription.findFirst({
    where: { userId, communityId: { in: accessibleCommunityIds } },
    select: { id: true },
  })
  return sub !== null
}

export async function assertMemberAccess(
  db: PrismaClient,
  accessibleCommunityIds: string[] | null,
  userId: string,
): Promise<void> {
  if (!(await hasMemberAccess(db, accessibleCommunityIds, userId))) {
    throw new ForbiddenError('You do not have access to this member', 'MEMBER_ACCESS_DENIED')
  }
}

/** Start of today, the cut-off every "is this subscription still running" check in the backend uses. */
function subscriptionCutoff(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

/**
 * Whether a member holds an active, unexpired subscription to a community, checked live. The expiry job only
 * runs daily, so `isActive` alone is not enough, and the community ids cached on the mobile session go stale
 * after a purchase or a lapse.
 */
export async function isPaidMemberOfCommunity(db: PrismaClient, userId: string, communityId: string): Promise<boolean> {
  const count = await db.subscription.count({
    where: { userId, communityId, isActive: true, ...notExpired(subscriptionCutoff()) },
  })
  return count > 0
}

/** Every community a member currently holds an active, unexpired subscription to (the free community included). */
export async function getPaidCommunityIds(db: PrismaClient, userId: string): Promise<Set<string>> {
  const rows = await db.subscription.findMany({
    where: { userId, isActive: true, ...notExpired(subscriptionCutoff()) },
    select: { communityId: true },
  })
  return new Set(rows.map(r => r.communityId))
}

export async function assertSuperAdmin(db: PrismaClient, adminId: string): Promise<void> {
  if (!(await isSuperAdmin(db, adminId))) {
    throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
  }
}
