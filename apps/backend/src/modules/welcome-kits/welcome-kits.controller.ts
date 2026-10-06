import type { Request, Response, NextFunction } from 'express'
import type { WelcomeKitsService } from './welcome-kits.service.js'
import { upsertWelcomeKitSchema } from './welcome-kits.validator.js'

// Express 5 types params as string | string[] — route params are always strings
function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class WelcomeKitsController {
  constructor(private readonly service: WelcomeKitsService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.listForAdmin(req.user!.accessibleCommunityIds)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await this.service.getForAdmin(req.user!.accessibleCommunityIds, getParam(req, 'communityId'))
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  upsert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = upsertWelcomeKitSchema.parse(req.body)
      const data = await this.service.upsert(req.user!.accessibleCommunityIds, getParam(req, 'communityId'), body)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.delete(req.user!.accessibleCommunityIds, getParam(req, 'communityId'))
      res.json({ success: true, message: 'Welcome kit deleted' })
    } catch (err) {
      next(err)
    }
  }

  getMobile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!
      const data = await this.service.getForMobile(
        { id: user.id, role: user.role, accessibleCommunityIds: user.accessibleCommunityIds },
        getParam(req, 'communityId'),
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }
}
