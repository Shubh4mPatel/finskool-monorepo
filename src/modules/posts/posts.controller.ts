import type { Request, Response, NextFunction } from 'express'
import type { PostsService } from './posts.service.js'
import { createPostSchema, updatePostSchema, pinPostSchema } from './posts.validator.js'

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
      const post = await this.service.updatePost(req.params['id']!, data, files)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deletePost(req.params['id']!)
      res.json({ success: true, message: 'Post deleted' })
    } catch (err) {
      next(err)
    }
  }

  publish = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const post = await this.service.publishPost(req.params['id']!)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }

  pin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { pinOrder } = pinPostSchema.parse(req.body)
      const post = await this.service.pinPost(req.params['id']!, pinOrder)
      res.json({ success: true, data: post })
    } catch (err) {
      next(err)
    }
  }
}
