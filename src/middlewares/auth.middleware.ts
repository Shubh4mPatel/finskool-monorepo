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
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Missing or invalid authorization header'))
  }

  const token = header.slice(7)
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
