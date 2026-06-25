import type { Request, Response, NextFunction } from 'express'
import type { CommentsService } from './comments.service.js'
import { createCommentSchema, listCommentsSchema } from './comments.validator.js'

function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = createCommentSchema.parse(req.body)
      const comment = await this.service.createComment(
        req.user!.id,
        req.user!.role,
        getParam(req, 'postId'),
        data,
      )
      res.status(201).json({ success: true, data: comment })
    } catch (err) {
      next(err)
    }
  }

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { cursor, limit } = listCommentsSchema.parse(req.query)
      const result = await this.service.listComments(getParam(req, 'postId'), cursor, limit)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.deleteComment(getParam(req, 'id'), req.user!.id, req.user!.role)
      res.json({ success: true, message: 'Comment deleted' })
    } catch (err) {
      next(err)
    }
  }
}
