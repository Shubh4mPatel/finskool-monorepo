import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { StockRecommendationsService } from './stock-recommendations.service.js'
import {
  createStockRecommendationSchema,
  updateStockRecommendationSchema,
} from './stock-recommendations.validator.js'
import { getAccessibleCommunityIds } from '../../lib/community-access.js'
import { ForbiddenError } from '../../shared/errors/index.js'
import prisma from '../../lib/prisma.js'

const listQuerySchema = z.object({
  communityId: z.string().uuid().optional(),
})

// Express 5 types params as string | string[] — route params are always strings
function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class StockRecommendationsController {
  constructor(private readonly service: StockRecommendationsService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { communityId } = listQuerySchema.parse(req.query)
      const user = req.user!

      let listParams: { communityId?: string; communityIds?: string[] }

      if (user.role === 'admin') {
        const accessible = await getAccessibleCommunityIds(prisma, user.id)
        if (accessible === null) {
          // Super admin: use client-provided query param (can see all communities)
          listParams = { ...(communityId !== undefined && { communityId }) }
        } else if (communityId !== undefined) {
          if (!accessible.includes(communityId)) {
            throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
          }
          listParams = { communityId }
        } else {
          // Scoped admin with no community specified: restrict to their granted set
          listParams = { communityIds: accessible }
        }
      } else {
        // Member: use selectedCommunityId from JWT (set at login or via select-community endpoint)
        if (user.selectedCommunityId) {
          listParams = { communityId: user.selectedCommunityId }
        } else {
          // No community selected yet — fall back to all subscribed communities
          listParams = { communityIds: user.communityIds }
        }
      }

      const result = await this.service.listRecommendations(listParams)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createStockRecommendationSchema.parse(req.body)
      const rec = await this.service.createRecommendation(req.user!.id, data)
      res.status(201).json({ success: true, data: rec })
    } catch (err) {
      next(err)
    }
  }

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = updateStockRecommendationSchema.parse(req.body)
      const rec = await this.service.updateRecommendation(getParam(req, 'id'), req.user!.id, data)
      res.json({ success: true, data: rec })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deleteRecommendation(getParam(req, 'id'), req.user!.id)
      res.json({ success: true, message: 'Recommendation deleted' })
    } catch (err) {
      next(err)
    }
  }
}
