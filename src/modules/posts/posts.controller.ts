import type { Request, Response, NextFunction } from 'express'
import type { PostsService } from './posts.service.js'
import { createPostSchema, updatePostSchema, pinPostSchema } from './posts.validator.js'

// Express 5 types params as string | string[] — route params are always strings
function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class PostsController {
  constructor(private readonly service: PostsService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createPostSchema.parse(req.body)
      const files = (req.files as Express.Multer.File[]) ?? []
      const post = await this.service.createPost(req.user!.id, data, files)
      res.status(201).json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = updatePostSchema.parse(req.body)
      const files = (req.files as Express.Multer.File[]) ?? []
      const post = await this.service.updatePost(getParam(req, 'id'), data, files)
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
