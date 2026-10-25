import type { NextFunction, Request, Response } from 'express'
import { BadRequestError } from '../../shared/errors/index.js'
import type { DashboardService, DashboardViewer } from './dashboard.service.js'
import { expiringQuerySchema, listQuerySchema, revenueQuerySchema } from './dashboard.validator.js'

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<void>

const viewer = (req: Request): DashboardViewer => ({ accessibleCommunityIds: req.user!.accessibleCommunityIds })

export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  kpis: Handler = async (req, res, next) => {
    try {
      res.json({ success: true, data: await this.service.getKpis(viewer(req)) })
    } catch (err) {
      next(err)
    }
  }

  revenue: Handler = async (req, res, next) => {
    try {
      const parsed = revenueQuerySchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      res.json({ success: true, data: await this.service.getRevenue(viewer(req), parsed.data.month) })
    } catch (err) {
      next(err)
    }
  }

  expiring: Handler = async (req, res, next) => {
    try {
      const parsed = expiringQuerySchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      res.json({ success: true, data: await this.service.getExpiring(viewer(req), parsed.data.limit) })
    } catch (err) {
      next(err)
    }
  }

  registrations: Handler = async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      res.json({ success: true, data: await this.service.getRegistrations(viewer(req), parsed.data.limit) })
    } catch (err) {
      next(err)
    }
  }

  tickets: Handler = async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Invalid query')
      res.json({ success: true, data: await this.service.getRecentTickets(viewer(req), parsed.data.limit) })
    } catch (err) {
      next(err)
    }
  }
}
