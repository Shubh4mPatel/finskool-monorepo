import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { PostsService } from './posts.service.js'

const communityIdQuerySchema = z.string().uuid('Invalid community ID').optional()

// Runs before GET /mobile/posts: resolves which community the feed is for and
// enforces access to it (403 if the caller isn't allowed). The result lands in
// res.locals.feedCommunityId — a community id, or null when there's no free
// community to fall back to.
export function mobileFeedCommunity(service: PostsService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = communityIdQuerySchema.parse(req.query['communityId'])
      res.locals['feedCommunityId'] = await service.resolveMobileFeedCommunity(req.user!, communityId)
      next()
    } catch (err) {
      next(err)
    }
  }
}
