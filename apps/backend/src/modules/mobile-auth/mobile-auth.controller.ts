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
} from './mobile-auth.validator.js'
import { env } from '../../config/env.js'

// Mirrors auth.controller.ts's own cookie constants — kept as its own copy so
// this module has no import-time coupling to the web auth controller (see
// mobile-auth.service.ts's login() for the same reasoning).
const COOKIE_BASE: CookieOptions = {
  httpOnly: true,
  secure: env.cookie.secure,
  sameSite: 'lax',
  path: '/',
}
const ACCESS_MAX_AGE = 15 * 60 * 1000
const REFRESH_MAX_AGE = 400 * 24 * 60 * 60 * 1000

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie('access_token', accessToken, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE })
  res.cookie('refresh_token', refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE })
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
      const { accessToken, refreshToken, user, communities } = await this.service.login(data)
      setAuthCookies(res, accessToken, refreshToken)
      res.json({ success: true, data: { user, communities } })
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
