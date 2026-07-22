import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { PostsService } from './posts.service.js'
import { createPostSchema, updatePostSchema } from './posts.validator.js'
import { generateUploadUrl } from '../../lib/minio.js'
import { getAccessibleCommunityIds } from '../../lib/community-access.js'
import { ForbiddenError } from '../../shared/errors/index.js'
import prisma from '../../lib/prisma.js'

const uploadUrlQuerySchema = z.object({
  filename: z.string().min(1, 'filename is required'),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  communityId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
})

// Express 5 types params as string | string[] — route params are always strings
function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class PostsController {
  constructor(private readonly service: PostsService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, pageSize, communityId, date, order } = listQuerySchema.parse(req.query)
      const user = req.user!

      let listParams: {
        page: number
        pageSize: number
        communityId?: string
        communityIds?: string[]
        date?: string
        order: 'asc' | 'desc'
      }

      const dateParam = date !== undefined ? { date } : {}

      if (user.role === 'admin') {
        const accessible = await getAccessibleCommunityIds(prisma, user.id)
        if (accessible === null) {
          // Super admin: use client-provided query param (can see all communities)
          listParams = { page, pageSize, order, ...dateParam, ...(communityId !== undefined && { communityId }) }
        } else if (communityId !== undefined) {
          if (!accessible.includes(communityId)) {
            throw new ForbiddenError('You do not have access to this community', 'COMMUNITY_ACCESS_DENIED')
          }
          listParams = { page, pageSize, communityId, order, ...dateParam }
        } else {
          // Scoped admin with no community specified: restrict to their granted set
          listParams = { page, pageSize, communityIds: accessible, order, ...dateParam }
        }
      } else {
        // Member: use selectedCommunityId from JWT (set at login or via select-community endpoint)
        if (user.selectedCommunityId) {
          listParams = { page, pageSize, communityId: user.selectedCommunityId, order, ...dateParam }
        } else {
          // No community selected yet — fall back to all subscribed communities
          listParams = { page, pageSize, communityIds: user.communityIds, order, ...dateParam }
        }
      }

      const result = await this.service.listPosts(listParams)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommented = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listCommentedPosts(req.user!.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  getUploadUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { filename } = uploadUrlQuerySchema.parse(req.query)
      const urls = await generateUploadUrl(filename)
      res.json({ success: true, data: urls })
    } catch (err) {
      next(err)
    }
  }

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createPostSchema.parse(req.body)
      const post = await this.service.createPost(req.user!.id, data)
      res.status(201).json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = updatePostSchema.parse(req.body)
      const post = await this.service.updatePost(getParam(req, 'id'), req.user!.id, data)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deletePost(getParam(req, 'id'), req.user!.id)
      res.json({ success: true, message: 'Post deleted' })
    } catch (err) {
      next(err)
    }
  }

  publish = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await this.service.publishPost(getParam(req, 'id'), req.user!.id)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  pin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await this.service.pinPost(getParam(req, 'id'), req.user!.id)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }
}
