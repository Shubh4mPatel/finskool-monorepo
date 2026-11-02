import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { PaymentsService } from './payments.service.js'
import type { PaymentsCheckoutService } from './payments.checkout.js'
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import prisma from '../../lib/prisma.js'
import { getReceiptDownloadUrl, listReceipts } from '../../lib/plan-receipt.js'

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1, 'razorpayOrderId is required'),
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required'),
})

const createCheckoutSchema = z.object({ communityId: z.string().uuid(), planId: z.string().uuid() })
const exchangeSchema = z.object({ token: z.string().min(20).max(100) })
const checkoutVerifySchema = z.object({
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required').max(64),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required').max(256),
})

function bearerToken(req: Request): string {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedError('Missing checkout session')
  return header.slice(7)
}

const uuidParamSchema = z.string().uuid()

function getParam(req: Request, name: string): string {
  const val = req.params[name]
  return Array.isArray(val) ? (val[0] ?? '') : (val ?? '')
}

// Route params reach Prisma as literal UUID column values — an unvalidated
// malformed id (typo, path traversal probe) would otherwise surface as a raw
// Postgres "invalid input syntax for type uuid" error, caught by no AppError
// branch in errorMiddleware and returned as an opaque 500 instead of a 400.
function getUuidParam(req: Request, name: string): string {
  const parsed = uuidParamSchema.safeParse(getParam(req, name))
  if (!parsed.success) throw new BadRequestError(`Invalid ${name}`)
  return parsed.data
}

export class PaymentsController {
  constructor(
    private readonly service: PaymentsService,
    private readonly checkout: PaymentsCheckoutService,
  ) {}

  listPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPlans(getUuidParam(req, 'communityId'))
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  listReceipts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await listReceipts(prisma, req.user!.id) })
    } catch (err) {
      next(err)
    }
  }

  downloadReceipt = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await getReceiptDownloadUrl(prisma, req.user!.id, getUuidParam(req, 'receiptId'))
      if (!result) throw new NotFoundError('Receipt not found')
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const communityId = getUuidParam(req, 'communityId')
      const planId = getUuidParam(req, 'planId')
      const result = await this.service.createOrder(req.user!.id, communityId, planId)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  verifyPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = verifyPaymentSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.service.verifyPayment(req.user!.id, parsed.data)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  // ─── Mobile webview checkout ─────────────────────────────────────────────

  createCheckoutSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createCheckoutSchema.safeParse(req.body)
      if (!parsed.success) {
        logger.warn({ userId: req.user?.id, issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }, 'checkout.createSession: invalid request body')
        throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      }
      const result = await this.checkout.createSession(req.user!.id, parsed.data.communityId, parsed.data.planId)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  exchangeCheckoutToken = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = exchangeSchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError('Invalid checkout token')
      const result = await this.checkout.exchange(parsed.data.token)
      res.set('Cache-Control', 'no-store')
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  verifyCheckout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = checkoutVerifySchema.safeParse(req.body)
      if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? 'Validation failed')
      const result = await this.checkout.verify(bearerToken(req), parsed.data.razorpayPaymentId, parsed.data.razorpaySignature)
      res.set('Cache-Control', 'no-store')
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }

  checkoutStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.checkout.status(bearerToken(req))
      res.set('Cache-Control', 'no-store')
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  }
}
