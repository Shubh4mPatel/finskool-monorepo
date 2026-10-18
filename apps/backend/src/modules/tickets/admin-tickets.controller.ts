import type { Request, Response, NextFunction } from 'express'
import type { AdminActor, AdminTicketsService } from './admin-tickets.service.js'
import { getIdParam } from './tickets.controller.js'
import {
  adminListTicketsQuerySchema,
  presignSchema,
  reassignSchema,
} from './tickets.validator.js'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function actor(req: Request): AdminActor {
  const u = req.user!
  return { id: u.id, isSuperAdmin: u.isSuperAdmin, accessibleCommunityIds: u.accessibleCommunityIds }
}

/** Web admin (support team) endpoints. */
export class AdminTicketsController {
  constructor(private readonly service: AdminTicketsService) {}

  presign: Handler = async (req, res, next) => {
    try {
      const body = presignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.createUploadUrl(actor(req), body) })
    } catch (err) {
      next(err)
    }
  }

  list: Handler = async (req, res, next) => {
    try {
      const query = adminListTicketsQuerySchema.parse(req.query)
      res.json({ success: true, data: await this.service.list(actor(req), query) })
    } catch (err) {
      next(err)
    }
  }

  stats: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.stats(actor(req)) })
    } catch (err) {
      next(err)
    }
  }

  get: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.get(actor(req), getIdParam(req, 'ticketId', 'Ticket')) })
    } catch (err) {
      next(err)
    }
  }

  claim: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.claim(actor(req), getIdParam(req, 'ticketId', 'Ticket')) })
    } catch (err) {
      next(err)
    }
  }

  reassign: Handler = async (req, res, next) => {
    try {
      const body = reassignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.reassign(actor(req), getIdParam(req, 'ticketId', 'Ticket'), body.adminId) })
    } catch (err) {
      next(err)
    }
  }

  resolve: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.resolve(actor(req), getIdParam(req, 'ticketId', 'Ticket')) })
    } catch (err) {
      next(err)
    }
  }

  attachmentUrl: Handler = async (req, res, next) => {
    try {
      const data = await this.service.getAttachmentUrl(
        actor(req),
        getIdParam(req, 'ticketId', 'Ticket'),
        getIdParam(req, 'attachmentId', 'Attachment'),
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }
}
