import type { Request, Response, NextFunction, CookieOptions } from 'express'
import type { MobileAuthService } from './mobile-auth.service.js'
import {
  mobileRegisterSchema,
  verifyOtpSchema,
  resendOtpSchema,
  mobileLoginSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  mobileSelectCommunitySchema,
} from './mobile-auth.validator.js'
import { env } from '../../config/env.js'
import { UnauthorizedError } from '../../shared/errors/index.js'

// No JWT for mobile at all — a single opaque session id (see
// mobile-auth.service.ts's login()) is the whole credential, stored only as
// an httpOnly cookie, never in a response body.
const MOBILE_COOKIE_BASE: CookieOptions = {
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: 'lax',
  path: '/',
}
// The DB row (MobileSession), not this cookie, is the real source of truth —
// this maxAge exists purely so the client's cookie jar doesn't evict the
// cookie early (a cookie with no maxAge is dropped whenever the app process
// ends). Long enough to effectively never expire on its own.
const MOBILE_SESSION_MAX_AGE = 400 * 24 * 60 * 60 * 1000

function setMobileSessionCookie(res: Response, sessionId: string): void {
  res.cookie('mobile_session_id', sessionId, { ...MOBILE_COOKIE_BASE, maxAge: MOBILE_SESSION_MAX_AGE })
}

function clearMobileSessionCookie(res: Response): void {
  res.clearCookie('mobile_session_id', MOBILE_COOKIE_BASE)
}

export class MobileAuthController {
  constructor(private readonly service: MobileAuthService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = mobileRegisterSchema.parse(req.body)
      const result = await this.service.register(data)
      // Deliberately no cookies and no `communities` here — the account isn't
      // considered registered until verifyOtp() succeeds.
      res.status(201).json({
        success: true,
        message: 'OTP sent to your email. Verify it to complete registration.',
        data: result,
      })
    } catch (err) {
      next(err)
    }
  }

  verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId, otp } = verifyOtpSchema.parse(req.body)
      await this.service.verifyOtp(userId, otp)
      // No cookies/tokens issued here either — verification only confirms the
      // phone; the mobile client calls POST /api/v1/auth/mobile/login separately.
      res.json({ success: true, message: 'Phone number verified. You can now log in.' })
    } catch (err) {
      next(err)
    }
  }

  resendOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = resendOtpSchema.parse(req.body)
      const result = await this.service.resendOtp(userId)
      res.json({ success: true, message: 'A new code has been sent to your email.', data: result })
    } catch (err) {
      next(err)
    }
  }

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = mobileLoginSchema.parse(req.body)
      const { sessionId, user, communities } = await this.service.login(data, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      })
      setMobileSessionCookie(res, sessionId)
      res.json({ success: true, data: { user, communities } })
    } catch (err) {
      next(err)
    }
  }

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.cookies?.['mobile_session_id'] as string | undefined
      if (sessionId) {
        await this.service.logout(sessionId)
      }
      clearMobileSessionCookie(res)
      res.json({ success: true, message: 'Logged out' })
    } catch (err) {
      next(err)
    }
  }

  selectCommunity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError('Not authenticated')
      const { communityId } = mobileSelectCommunitySchema.parse(req.body)
      await this.service.selectCommunity(req.user.id, communityId)
      res.json({ success: true })
    } catch (err) {
      next(err)
    }
  }

  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body)
      await this.service.forgotPassword(email)
      // Same message whether or not the email matched anything — see
      // MobileAuthService.forgotPassword's doc comment.
      res.json({
        success: true,
        message: "If an account with this email exists and is verified, we've sent a password reset code.",
      })
    } catch (err) {
      next(err)
    }
  }

  verifyResetOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, otp } = verifyResetOtpSchema.parse(req.body)
      const result = await this.service.verifyResetOtp(email, otp)
      // No cookies/session here — `result.cypher` is what authorizes the
      // follow-up resetPassword call instead.
      res.json({ success: true, message: 'Code verified.', data: result })
    } catch (err) {
      next(err)
    }
  }

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { cypher, newPassword } = resetPasswordSchema.parse(req.body)
      await this.service.resetPassword(cypher, newPassword)
      // No auto-login — the mobile client calls POST /auth/mobile/login separately.
      res.json({ success: true, message: 'Password reset successfully. Please log in.' })
    } catch (err) {
      next(err)
    }
  }
}
