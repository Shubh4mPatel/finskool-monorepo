import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { PostsService } from './posts.service.js'
import { createPostSchema, updatePostSchema, pinPostSchema } from './posts.validator.js'
import { generateUploadUrl } from '../../lib/minio.js'

const uploadUrlQuerySchema = z.object({
  filename: z.string().min(1, 'filename is required'),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  communityId: z.string().uuid().optional(),
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
      const { page, pageSize, communityId } = listQuerySchema.parse(req.query)
      const user = req.user!

      let listParams: { page: number; pageSize: number; communityId?: string; communityIds?: string[] }

      if (user.role === 'admin') {
        // Admin: use client-provided query param (can see all communities)
        listParams = { page, pageSize, ...(communityId !== undefined && { communityId }) }
      } else {
        // Member: use selectedCommunityId from JWT (set at login or via select-community endpoint)
        if (user.selectedCommunityId) {
          listParams = { page, pageSize, communityId: user.selectedCommunityId }
        } else {
          // No community selected yet — fall back to all subscribed communities
          listParams = { page, pageSize, communityIds: user.communityIds }
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
      const post = await this.service.updatePost(getParam(req, 'id'), data)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deletePost(getParam(req, 'id'))
      res.json({ success: true, message: 'Post deleted' })
    } catch (err) {
      next(err)
    }
  }

  publish = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await this.service.publishPost(getParam(req, 'id'))
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  pin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pinOrder } = pinPostSchema.parse(req.body)
      const post = await this.service.pinPost(getParam(req, 'id'), pinOrder)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }
}
