import type { Request, Response, NextFunction } from 'express'
import { BadRequestError } from '../../shared/errors/index.js'
import { getIdParam } from '../tickets/tickets.controller.js'
import type { ServicesService } from './services.service.js'
import {
  clientKeySchema,
  createServiceRequestSchema,
  listServiceRequestsQuerySchema,
  presignSchema,
  ratingSchema,
} from './services.validator.js'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

const requestId = (req: Request) => getIdParam(req, 'requestId', 'Service request')

/** Member (requester) endpoints. */
export class ServicesController {
  constructor(private readonly service: ServicesService) {}

  catalog: Handler = async (_req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.listCatalog() })
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
      const body = createServiceRequestSchema.parse(req.body)
      const data = await this.service.create(req.user!.id, key.data, body)
      res.status(201).json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }

  list: Handler = async (req, res, next) => {
    try {
      const query = listServiceRequestsQuerySchema.parse(req.query)
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
      res.json({ success: true, data: await this.service.get(req.user!.id, requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  cancel: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.cancel(req.user!.id, requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  rate: Handler = async (req, res, next) => {
    try {
      const body = ratingSchema.parse(req.body)
      res.json({ success: true, data: await this.service.rate(req.user!.id, requestId(req), body) })
    } catch (err) {
      next(err)
    }
  }

  attachmentUrl: Handler = async (req, res, next) => {
    try {
      const data = await this.service.getAttachmentUrl(
        req.user!.id,
        requestId(req),
        getIdParam(req, 'attachmentId', 'Attachment'),
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }
}
