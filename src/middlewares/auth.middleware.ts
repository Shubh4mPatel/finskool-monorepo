import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { UnauthorizedError, ForbiddenError } from '../shared/errors/index.js'
import type { UserRole } from '../generated/prisma/client.js'

export interface JwtPayload {
  sub: string
  role: UserRole
  type: 'access' | 'refresh'
}

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: UserRole }
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  // Primary: read from httpOnly cookie set by login/register
  // Fallback: Authorization: Bearer header (for tooling / server-to-server)
  const cookieToken = req.cookies?.['access_token'] as string | undefined
  const header = req.headers.authorization
  const token = cookieToken ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined)

  if (!token) {
    return next(new UnauthorizedError('Not authenticated'))
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret) as JwtPayload
    if (payload.type !== 'access') {
      return next(new UnauthorizedError('Invalid token type'))
    }
    req.user = { id: payload.sub, role: payload.role }
    next()
  } catch {
    next(new UnauthorizedError('Invalid or expired token'))
  }
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
