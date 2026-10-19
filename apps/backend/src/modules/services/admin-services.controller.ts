import type { Request, Response, NextFunction } from 'express'
import { getIdParam } from '../tickets/tickets.controller.js'
import type { AdminViewer } from '../tickets/tickets.shared.js'
import type { AdminServicesService } from './admin-services.service.js'
import {
  adminListServiceRequestsQuerySchema,
  catalogImagePresignSchema,
  createCatalogServiceSchema,
  presignSchema,
  reassignSchema,
  updateCatalogServiceSchema,
} from './services.validator.js'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function actor(req: Request): AdminViewer {
  const u = req.user!
  return { id: u.id, isSuperAdmin: u.isSuperAdmin }
}

const requestId = (req: Request) => getIdParam(req, 'requestId', 'Service request')
const serviceId = (req: Request) => getIdParam(req, 'serviceId', 'Service')

/** Web admin (support team) endpoints. */
export class AdminServicesController {
  constructor(private readonly service: AdminServicesService) {}

  // ─── Catalog ──────────────────────────────────────────────────────────────

  listCatalog: Handler = async (_req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.listCatalog() })
    } catch (err) {
      next(err)
    }
  }

  createService: Handler = async (req, res, next) => {
    try {
      const body = createCatalogServiceSchema.parse(req.body)
      res.status(201).json({ success: true, data: await this.service.createService(actor(req), body) })
    } catch (err) {
      next(err)
    }
  }

  updateService: Handler = async (req, res, next) => {
    try {
      const body = updateCatalogServiceSchema.parse(req.body)
      res.json({ success: true, data: await this.service.updateService(serviceId(req), body) })
    } catch (err) {
      next(err)
    }
  }

  deleteService: Handler = async (req, res, next) => {
    try {
      await this.service.deleteService(serviceId(req))
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  }

  catalogImagePresign: Handler = async (req, res, next) => {
    try {
      const body = catalogImagePresignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.createCatalogImageUploadUrl(body.fileName) })
    } catch (err) {
      next(err)
    }
  }

  // ─── Requests ─────────────────────────────────────────────────────────────

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
      const query = adminListServiceRequestsQuerySchema.parse(req.query)
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
      res.json({ success: true, data: await this.service.get(actor(req), requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  claim: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.claim(actor(req), requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  reassign: Handler = async (req, res, next) => {
    try {
      const body = reassignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.reassign(actor(req), requestId(req), body.adminId) })
    } catch (err) {
      next(err)
    }
  }

  close: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.close(actor(req), requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  attachmentUrl: Handler = async (req, res, next) => {
    try {
      const data = await this.service.getAttachmentUrl(requestId(req), getIdParam(req, 'attachmentId', 'Attachment'))
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  }
}
