import type { Request, Response, NextFunction, CookieOptions } from 'express'
import { z } from 'zod'
import type { AuthService } from './auth.service.js'
import { registerSchema, loginSchema } from './auth.validator.js'
import { env } from '../../config/env.js'
import { UnauthorizedError } from '../../shared/errors/index.js'

const selectCommunitySchema = z.object({
  communityId: z.string().uuid('Invalid community ID'),
})

const COOKIE_BASE: CookieOptions = {
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: 'strict',
  path: '/',
}

// Access token cookie matches JWT expiry — browser auto-cleans it after 15 min
const ACCESS_MAX_AGE = 15 * 60 * 1000
// Refresh token cookie is long-lived (400 days) — actual validity controlled by Redis, not time
const REFRESH_MAX_AGE = 400 * 24 * 60 * 60 * 1000

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE })
  res.cookie('refresh_token', refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE })
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('access_token', COOKIE_BASE)
  res.clearCookie('refresh_token', COOKIE_BASE)
}

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = registerSchema.parse(req.body)
      const { accessToken, refreshToken, user, communities } = await this.service.register(data)
      setAuthCookies(res, accessToken, refreshToken)
      res.status(201).json({ success: true, data: { user, communities } })
    } catch (err) {
      next(err)
    }
  }

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = loginSchema.parse(req.body)
      const { accessToken, refreshToken, user, communities } = await this.service.login(data)
      setAuthCookies(res, accessToken, refreshToken)
      res.json({ success: true, data: { user, communities } })
    } catch (err) {
      next(err)
    }
  }

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies['refresh_token'] as string | undefined
      if (!refreshToken) throw new UnauthorizedError('No refresh token provided')
      const { accessToken } = await this.service.refresh(refreshToken)
      res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const refreshToken = req.cookies['refresh_token'] as string | undefined
      if (refreshToken) {
        await this.service.logout(refreshToken)
      }
      clearAuthCookies(res)
      res.json({ success: true, message: 'Logged out' })
    } catch (err) {
      next(err)
    }
  }

  selectCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { communityId } = selectCommunitySchema.parse(req.body)
      const user = req.user!
      const accessToken = await this.service.selectCommunity(user.id, communityId, user.communityIds)
      res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE })
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getMe(req.user!.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
