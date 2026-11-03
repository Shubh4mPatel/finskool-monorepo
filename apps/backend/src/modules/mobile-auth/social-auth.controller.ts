import type { Request, Response, NextFunction } from 'express'
import { UnauthorizedError } from '../../shared/errors/index.js'
import type { SocialAuthService, SocialLoginResult } from './social-auth.service.js'
import { setMobileSessionCookie } from './mobile-auth.controller.js'
import { meSocialLinkSchema, socialLinkSchema, socialLoginSchema, socialPhoneSchema, socialVerifyOtpSchema } from './mobile-auth.validator.js'

const meta = (req: Request) => ({ userAgent: req.headers['user-agent'], ip: req.ip })

/** A finished login sets the same cookie as password login and answers with the same body (plus `status`). */
function respond(res: Response, result: SocialLoginResult): void {
  if (result.status === 'logged_in') {
    const { sessionId, status, user, communities } = result
    setMobileSessionCookie(res, sessionId)
    res.json({ success: true, data: { status, user, communities } })
    return
  }
  res.json({ success: true, data: result })
}

export class SocialAuthController {
  constructor(private readonly service: SocialAuthService) {}

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      respond(res, await this.service.login(socialLoginSchema.parse(req.body), meta(req)))
    } catch (err) {
      next(err)
    }
  }

  link = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      respond(res, await this.service.link(socialLinkSchema.parse(req.body), meta(req)))
    } catch (err) {
      next(err)
    }
  }

  phone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.startPhone(socialPhoneSchema.parse(req.body), meta(req))
      res.json({ success: true, message: 'A code has been sent to your WhatsApp.', data })
    } catch (err) {
      next(err)
    }
  }

  verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      respond(res, await this.service.verifyOtp(socialVerifyOtpSchema.parse(req.body), meta(req)))
    } catch (err) {
      next(err)
    }
  }

  linkToAccount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) throw new UnauthorizedError('Not authenticated')
      res.json({ success: true, data: await this.service.linkToAccount(req.user.id, meSocialLinkSchema.parse(req.body)) })
    } catch (err) {
      next(err)
    }
  }
}
