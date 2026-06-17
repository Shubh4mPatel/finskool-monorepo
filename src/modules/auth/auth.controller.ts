import type { Request, Response, NextFunction } from 'express'
import type { AuthService } from './auth.service.js'
import { registerSchema, loginSchema, refreshSchema } from './auth.validator.js'

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = registerSchema.parse(req.body)
      const result = await this.service.register(data)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = loginSchema.parse(req.body)
      const result = await this.service.login(data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body)
      const result = await this.service.refresh(refreshToken)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body)
      await this.service.logout(refreshToken)
      res.json({ success: true, message: 'Logged out' })
    } catch (err) {
      next(err)
    }
  }

  me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = await this.service.getMe(req.user!.id)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  }
}
