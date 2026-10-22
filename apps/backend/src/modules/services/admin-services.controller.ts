import type { Request, Response, NextFunction } from 'express'
import { SERVICE_TYPES } from './services.catalog.js'
import { ForbiddenError } from '../../shared/errors/index.js'
import { getIdParam } from '../tickets/tickets.controller.js'
import type { AdminViewer } from '../tickets/tickets.shared.js'
import type { AdminServicesService } from './admin-services.service.js'
import {
  adminListServiceRequestsQuerySchema,
  catalogImagePresignSchema,
  createCatalogServiceSchema,
  presignSchema,
  billingSettingsSchema,
  reassignSchema,
  sendQuoteSchema,
  updateCatalogServiceSchema,
} from './services.validator.js'
import { GST_STATES } from './services.billing.js'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

function actor(req: Request): AdminViewer {
  const u = req.user!
  return { id: u.id, isSuperAdmin: u.isSuperAdmin }
}

function requireSuperAdmin(req: Request): void {
  if (!actor(req).isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
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

  getService: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.getService(serviceId(req)) })
    } catch (err) {
      next(err)
    }
  }

  serviceTypes: Handler = async (_req, res, next) => {
    try {
      res.json({ success: true, data: SERVICE_TYPES })
    } catch (err) {
      next(err)
    }
  }

  createService: Handler = async (req, res, next) => {
    try {
      requireSuperAdmin(req)
      const body = createCatalogServiceSchema.parse(req.body)
      res.status(201).json({ success: true, data: await this.service.createService(actor(req), body) })
    } catch (err) {
      next(err)
    }
  }

  updateService: Handler = async (req, res, next) => {
    try {
      requireSuperAdmin(req)
      const body = updateCatalogServiceSchema.parse(req.body)
      res.json({ success: true, data: await this.service.updateService(serviceId(req), body) })
    } catch (err) {
      next(err)
    }
  }

  deleteService: Handler = async (req, res, next) => {
    try {
      requireSuperAdmin(req)
      await this.service.deleteService(serviceId(req))
      res.json({ success: true, data: null })
    } catch (err) {
      next(err)
    }
  }

  catalogImagePresign: Handler = async (req, res, next) => {
    try {
      requireSuperAdmin(req)
      const body = catalogImagePresignSchema.parse(req.body)
      res.json({ success: true, data: await this.service.createCatalogImageUploadUrl(body.fileName) })
    } catch (err) {
      next(err)
    }
  }

  // ─── Quotes, billing ──────────────────────────────────────────────────────

  sendQuote: Handler = async (req, res, next) => {
    try {
      const body = sendQuoteSchema.parse(req.body)
      res.status(201).json({ success: true, data: await this.service.sendQuote(actor(req), requestId(req), body) })
    } catch (err) {
      next(err)
    }
  }

  resolveReview: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.resolveReview(actor(req), requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  invoiceUrl: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.getInvoiceUrl(requestId(req)) })
    } catch (err) {
      next(err)
    }
  }

  quoteDefaults: Handler = async (_req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.quoteDefaults() })
    } catch (err) {
      next(err)
    }
  }

  gstStates: Handler = async (_req, res, next) => {
    try {
      res.json({ success: true, data: GST_STATES })
    } catch (err) {
      next(err)
    }
  }

  getBillingSettings: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.getBillingSettings(actor(req)) })
    } catch (err) {
      next(err)
    }
  }

  updateBillingSettings: Handler = async (req, res, next) => {
    try {
      // Permission before validation: a non-super admin must get 403 whatever they send.
      if (!actor(req).isSuperAdmin) throw new ForbiddenError('Super admin access required', 'SUPER_ADMIN_REQUIRED')
      const body = billingSettingsSchema.parse(req.body)
      res.json({ success: true, data: await this.service.updateBillingSettings(actor(req), body) })
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
