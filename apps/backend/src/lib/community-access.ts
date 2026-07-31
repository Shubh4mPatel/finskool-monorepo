import type { PrismaClient } from '../generated/prisma/client.js'
import { ForbiddenError } from '../shared/errors/index.js'

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

export async function assertSuperAdmin(db: PrismaClient, adminId: string): Promise<void> {
  if (!(await isSuperAdmin(db, adminId))) {
    throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
  }
}
