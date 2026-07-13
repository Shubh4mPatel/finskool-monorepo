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

export async function assertCommunityAccess(db: PrismaClient, adminId: string, communityId: string): Promise<void> {
  if (await isSuperAdmin(db, adminId)) return
  const access = await db.communityAdmin.findUnique({
    where: { uq_community_admin: { communityId, adminId } },
  })
  if (!access) {
    throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
  }
}

export async function assertSuperAdmin(db: PrismaClient, adminId: string): Promise<void> {
  if (!(await isSuperAdmin(db, adminId))) {
    throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
  }
}
