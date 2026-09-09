import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { UnauthorizedError, ForbiddenError } from '../shared/errors/index.js'
import type { UserRole } from '../generated/prisma/client.js'
import prisma from '../lib/prisma.js'
import { validateMobileSession } from '../lib/mobile-session.js'

export interface JwtPayload {
  sub: string
  role: UserRole
  type: 'access' | 'refresh'
  communityIds: string[]
  selectedCommunityId: string | null
  accessibleCommunityIds: string[] | null
  // Optional: tokens issued before this field existed won't carry it — authenticate()
  // below defaults it to false. Max staleness is one access-token lifetime.
  isSuperAdmin?: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        role: UserRole
        communityIds: string[]
        selectedCommunityId: string | null
        accessibleCommunityIds: string[] | null
        isSuperAdmin: boolean
        // Which of the two auth paths below produced this request — 'mobile' means
        // req.user came from a MobileSession lookup rather than a verified JWT.
        // Needed by routes (e.g. posts.controller.ts's member communityId param)
        // that behave differently for the mobile app vs. the web JWT flow.
        authVia: 'web' | 'mobile'
      }
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const cookieToken = req.cookies?.['access_token'] as string | undefined
  const header = req.headers.authorization
  const token = cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)

  // Web path — unchanged from before this function had a second (mobile)
  // path below: pure JWT verify, zero I/O, exactly as it always was.
  if (token) {
    try {
      const payload = jwt.verify(token, env.jwt.secret) as JwtPayload
      if (payload.type !== 'access') {
        return next(new UnauthorizedError('Invalid token type'))
      }
      req.user = {
        id: payload.sub,
        role: payload.role,
        communityIds: payload.communityIds ?? [],
        selectedCommunityId: payload.selectedCommunityId ?? null,
        // `?? []` would be wrong here: null is a meaningful value (super admin,
        // unrestricted) distinct from undefined (claim missing on a token issued
        // before this field existed) — only the latter should fall back to [].
        accessibleCommunityIds: payload.accessibleCommunityIds === undefined ? [] : payload.accessibleCommunityIds,
        isSuperAdmin: payload.isSuperAdmin ?? false,
        authVia: 'web',
      }
      return next()
    } catch {
      return next(new UnauthorizedError('Invalid or expired token'))
    }
  }

  // Mobile path — no JWT at all for mobile (see mobile-auth.service.ts); the
  // cookie itself is the lookup key into MobileSession. Only reached when
  // there's no access_token/Bearer at all, so this costs web requests nothing.
  const mobileSessionId = req.cookies?.['mobile_session_id'] as string | undefined
  if (mobileSessionId) {
    const ctx = await validateMobileSession(prisma, mobileSessionId)
    if (!ctx) {
      return next(new UnauthorizedError('Session ended. Please log in again.', 'SESSION_INVALIDATED'))
    }
    req.user = {
      id: ctx.userId,
      role: ctx.role as UserRole,
      communityIds: ctx.communityIds,
      selectedCommunityId: ctx.selectedCommunityId,
      accessibleCommunityIds: ctx.accessibleCommunityIds,
      isSuperAdmin: ctx.isSuperAdmin,
      authVia: 'mobile',
    }
    return next()
  }

  return next(new UnauthorizedError('Not authenticated'))
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError())
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError('Insufficient permissions'))
    }
    next()
  }
}
