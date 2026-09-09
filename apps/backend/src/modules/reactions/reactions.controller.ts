import type { Request, Response, NextFunction } from 'express'
import type { ReactionsService } from './reactions.service.js'
import { upsertReactionSchema } from './reactions.validator.js'

function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class ReactionsController {
  constructor(private readonly service: ReactionsService) {}

  listTypes = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const types = await this.service.listReactionTypes()
      res.json({ success: true, data: types })
    } catch (err) {
      next(err)
    }
  }

  upsert = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = upsertReactionSchema.parse(req.body)
      const result = await this.service.upsertReaction(
        req.user!.id,
        req.user!.role,
        req.user!.accessibleCommunityIds,
        getParam(req, 'postId'),
        data,
      )
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.removeReaction(
        req.user!.id,
        req.user!.role,
        req.user!.accessibleCommunityIds,
        getParam(req, 'postId'),
      )
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
