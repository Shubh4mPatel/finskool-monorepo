import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { StockRecommendationsService } from './stock-recommendations.service.js'
import {
  createStockRecommendationSchema,
  updateStockRecommendationSchema,
} from './stock-recommendations.validator.js'
import { ForbiddenError } from '../../shared/errors/index.js'

const listQuerySchema = z.object({
  communityId: z.string().uuid().optional(),
  riskLevel: z.enum(['low', 'medium', 'high']).optional(),
  actionCall: z.enum(['buy', 'hold', 'exit']).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
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
      const { communityId, riskLevel, actionCall, search, page, pageSize } = listQuerySchema.parse(req.query)
      const user = req.user!

      let scope: { communityId?: string; communityIds?: string[] }

      if (user.role === 'admin') {
        const accessible = user.accessibleCommunityIds
        if (accessible === null) {
          // Super admin: use client-provided query param (can see all communities)
          scope = { ...(communityId !== undefined && { communityId }) }
        } else if (communityId !== undefined) {
          if (!accessible.includes(communityId)) {
            throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
          }
          scope = { communityId }
        } else {
          // Scoped admin with no community specified: restrict to their granted set
          scope = { communityIds: accessible }
        }
      } else {
        // Member: use selectedCommunityId from JWT (set at login or via select-community endpoint)
        if (user.selectedCommunityId) {
          scope = { communityId: user.selectedCommunityId }
        } else {
          // No community selected yet — fall back to all subscribed communities
          scope = { communityIds: user.communityIds }
        }
      }

      const result = await this.service.listRecommendations({
        ...scope,
        riskLevel,
        actionCall,
        search,
        page,
        pageSize,
      })
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createStockRecommendationSchema.parse(req.body)
      const recs = await this.service.createRecommendation(req.user!.id, req.user!.accessibleCommunityIds, data)
      res.status(201).json({ success: true, data: recs })
    } catch (err) {
      next(err)
    }
  }

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = updateStockRecommendationSchema.parse(req.body)
      const rec = await this.service.updateRecommendation(
        getParam(req, 'id'),
        req.user!.id,
        req.user!.accessibleCommunityIds,
        data,
      )
      res.json({ success: true, data: rec })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deleteRecommendation(
        getParam(req, 'id'),
        req.user!.id,
        req.user!.accessibleCommunityIds,
      )
      res.json({ success: true, message: 'Recommendation deleted' })
    } catch (err) {
      next(err)
    }
  }
}
