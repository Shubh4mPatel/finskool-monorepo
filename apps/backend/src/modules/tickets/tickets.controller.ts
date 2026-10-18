import type { Request, Response, NextFunction } from 'express'
import { BadRequestError } from '../../shared/errors/index.js'
import type { TicketsService } from './tickets.service.js'
import {
  clientKeySchema,
  createTicketSchema,
  listTicketsQuerySchema,
  presignSchema,
  ratingSchema,
} from './tickets.validator.js'

// Express 5 types params as string | string[] — route params are always strings
export function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

/** Mobile (ticket owner) endpoints. */
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  communities: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.listCommunityOptions(req.user!.id) })
    } catch (err) {
      next(err)
    }
  }

  presign: Handler = async (req, res, next) => {
    try {
      const body = presignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.createUploadUrl(req.user!.id, body) })
    } catch (err) {
      next(err)
    }
  }

  create: Handler = async (req, res, next) => {
    try {
      const key = clientKeySchema.safeParse(req.header('Idempotency-Key'))
      if (!key.success) {
        throw new BadRequestError('Idempotency-Key header (8-64 chars) is required', 'IDEMPOTENCY_KEY_REQUIRED')
      }
      const body = createTicketSchema.parse(req.body)
      const data = await this.service.create(req.user!.id, key.data, body)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  list: Handler = async (req, res, next) => {
    try {
      const query = listTicketsQuerySchema.parse(req.query)
      res.json({ success: true, data: await this.service.list(req.user!.id, query) })
    } catch (err) {
      next(err)
    }
  }

  unreadTotal: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.unreadTotal(req.user!.id) })
    } catch (err) {
      next(err)
    }
  }

  get: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.get(req.user!.id, getParam(req, 'ticketId')) })
    } catch (err) {
      next(err)
    }
  }

  rate: Handler = async (req, res, next) => {
    try {
      const body = ratingSchema.parse(req.body)
      res.json({ success: true, data: await this.service.rate(req.user!.id, getParam(req, 'ticketId'), body) })
    } catch (err) {
      next(err)
    }
  }

  attachmentUrl: Handler = async (req, res, next) => {
    try {
      const data = await this.service.getAttachmentUrl(
        req.user!.id,
        getParam(req, 'ticketId'),
        getParam(req, 'attachmentId'),
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }
}
