import { createHash } from 'crypto'
import type { PrismaClient } from '../generated/prisma/client.js'

// Shared by both mobile-auth.service.ts (writes, on login/logout/select-community)
// and auth.middleware.ts (reads, on every mobile-authenticated request) so the
// two never drift on how a session id is hashed or what counts as valid.
export function hashSessionId(rawSessionId: string): string {
  return createHash('sha256').update(rawSessionId).digest('hex')
}

export interface MobileSessionContext {
  userId: string
  role: string
  isSuperAdmin: boolean
  communityIds: string[]
  selectedCommunityId: string | null
  // Cached at login (Option C) — see the MobileSession model's own doc
  // comment in schema.prisma for why null vs. an array matters here.
  accessibleCommunityIds: string[] | null
}

/**
 * Looks up the mobile session by the raw (unhashed) session id the client
 * presented, and returns null for every reason a caller should treat as
 * "not authenticated" — no such session (never existed, superseded by a
 * newer login, or logged out), or the account itself is no longer usable
 * (deactivated/deleted). Callers that need to distinguish those reasons more
 * precisely (mobile-auth.service.ts's own login/logout) don't go through
 * this function — this is specifically the coarse check authenticate() needs.
 */
export async function validateMobileSession(
  db: PrismaClient,
  rawSessionId: string,
): Promise<MobileSessionContext | null> {
  const session = await db.mobileSession.findUnique({
    where: { sessionIdHash: hashSessionId(rawSessionId) },
    include: {
      user: { select: { id: true, role: true, isSuperAdmin: true, status: true, deletedAt: true } },
    },
  })
  if (!session || session.user.status !== 'active' || session.user.deletedAt) return null

  return {
    userId: session.user.id,
    role: session.user.role,
    isSuperAdmin: session.user.isSuperAdmin,
    communityIds: session.communityIds,
    selectedCommunityId: session.selectedCommunityId,
    accessibleCommunityIds: session.accessibleCommunityIds as string[] | null,
  }
}
