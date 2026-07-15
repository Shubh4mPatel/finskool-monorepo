import type { Request, Response, NextFunction } from 'express'
import type { NotificationsService } from './notifications.service.js'
import { listNotificationsSchema } from './notifications.validator.js'

// Express 5 types params as string | string[] — route params are always strings
function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { page, pageSize, communityId } = listNotificationsSchema.parse(req.query)
      const result = await this.service.listForUser(req.user!.id, page, pageSize, communityId)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  unreadCount = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const count = await this.service.unreadCount(req.user!.id)
      res.json({ success: true, data: { count } })
    } catch (err) {
      next(err)
    }
  }

  markRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await this.service.markRead(req.user!.id, getParam(req, 'id'))
      res.json({ success: true, message: 'Notification marked as read' })
    } catch (err) {
      next(err)
    }
  }

  markAllRead = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.markAllRead(req.user!.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
