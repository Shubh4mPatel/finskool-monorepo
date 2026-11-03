import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
import { BadRequestError } from '../../shared/errors/index.js'
import type { PerformanceService } from './performance.service.js'
import {
  createBoardSchema,
  createPeriodSchema,
  importBodySchema,
  listTradesQuerySchema,
  mobileTradesQuerySchema,
  overviewQuerySchema,
  segmentBodySchema,
  settingsSchema,
  updatePeriodSchema,
} from './performance.validator.js'

const uuidSchema = z.string().uuid()

/** A route parameter that must be a UUID: anything else is a 400 here instead of a database error. */
function uuidParam(req: Request, name: string): string {
  const raw = req.params[name]
  const value = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new BadRequestError('Invalid id')
  return parsed.data
}

export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  /** Wraps a handler so a thrown error reaches the error middleware, and the result is sent as `{ success, data }`. */
  private handle(fn: (req: Request) => Promise<unknown>, status = 200): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        res.status(status).json({ success: true, data: await fn(req) })
      } catch (err) {
        next(err)
      }
    }
  }

  private accessible = (req: Request) => req.user!.accessibleCommunityIds

  // ─── Admin ────────────────────────────────────────────────────────────────

  listBoards = this.handle(req => this.service.listBoards(this.accessible(req)))

  createBoard = this.handle(req => this.service.createBoard(req.user!.isSuperAdmin, createBoardSchema.parse(req.body)), 201)

  overview = this.handle(req => {
    const { segment } = overviewQuerySchema.parse(req.query)
    return this.service.getOverview(this.accessible(req), uuidParam(req, 'communityId'), segment)
  })

  updateSettings = this.handle(req =>
    this.service.updateSettings(this.accessible(req), uuidParam(req, 'communityId'), settingsSchema.parse(req.body)),
  )

  listTrades = this.handle(req =>
    this.service.listTrades(this.accessible(req), uuidParam(req, 'communityId'), listTradesQuerySchema.parse(req.query)),
  )

  createTrade = this.handle(req => {
    const { segment } = segmentBodySchema.parse(req.body)
    return this.service.createTrade(this.accessible(req), uuidParam(req, 'communityId'), segment, req.body)
  }, 201)

  updateTrade = this.handle(req =>
    this.service.updateTrade(this.accessible(req), uuidParam(req, 'communityId'), uuidParam(req, 'tradeId'), req.body),
  )

  deleteTrade = this.handle(async req => {
    await this.service.deleteTrade(this.accessible(req), uuidParam(req, 'communityId'), uuidParam(req, 'tradeId'))
    return { deleted: true }
  })

  importTrades = this.handle(req =>
    this.service.importTrades(this.accessible(req), uuidParam(req, 'communityId'), importBodySchema.parse(req.body)),
  )

  createPeriod = this.handle(req =>
    this.service.createPeriod(this.accessible(req), uuidParam(req, 'communityId'), createPeriodSchema.parse(req.body)),
  201)

  updatePeriod = this.handle(req =>
    this.service.updatePeriod(
      this.accessible(req),
      uuidParam(req, 'communityId'),
      uuidParam(req, 'periodId'),
      updatePeriodSchema.parse(req.body),
    ),
  )

  deletePeriod = this.handle(async req => {
    await this.service.deletePeriod(this.accessible(req), uuidParam(req, 'communityId'), uuidParam(req, 'periodId'))
    return { deleted: true }
  })

  // ─── Mobile ───────────────────────────────────────────────────────────────

  private mobileUser = (req: Request) => {
    const u = req.user!
    return { id: u.id, role: u.role, accessibleCommunityIds: u.accessibleCommunityIds }
  }

  listBoardsMobile = this.handle(req => this.service.listBoardsForMobile(this.mobileUser(req)))

  getMobile = this.handle(req =>
    this.service.getForMobile(this.mobileUser(req), uuidParam(req, 'communityId'), mobileTradesQuerySchema.parse(req.query)),
  )
}
