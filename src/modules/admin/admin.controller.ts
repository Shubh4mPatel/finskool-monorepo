import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { AdminService } from './admin.service.js'
import { BadRequestError } from '../../shared/errors/index.js'

const importQuerySchema = z.object({
  duplicateStrategy: z.enum(['skip', 'overwrite']).default('skip'),
})

const listNotificationsSchema = z.object({
  isReplied: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => (v === undefined ? undefined : v === 'true')),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export class AdminController {
  constructor(private readonly service: AdminService) {}

  importCsv = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) throw new BadRequestError('No file uploaded. Send a CSV or Excel file in the "file" field.')

      const { duplicateStrategy } = importQuerySchema.parse(req.query)
      const result = await this.service.importUsers(req.file.buffer, req.user!.id, duplicateStrategy)
      res.status(200).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listCommentNotifications = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { isReplied, cursor, limit } = listNotificationsSchema.parse(req.query)
      const result = await this.service.listCommentNotifications(isReplied, cursor, limit)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  markNotificationReplied = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = req.params['id']
      const id = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
      const result = await this.service.markNotificationReplied(id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
