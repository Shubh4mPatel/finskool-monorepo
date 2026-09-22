import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { PaymentsService } from './payments.service.js'
import { BadRequestError } from '../../shared/errors/index.js'

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1, 'razorpayOrderId is required'),
  razorpayPaymentId: z.string().min(1, 'razorpayPaymentId is required'),
  razorpaySignature: z.string().min(1, 'razorpaySignature is required'),
})

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
  constructor(private readonly service: PaymentsService) {}

  listPlans = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.listPlans(getUuidParam(req, 'communityId'))
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
}
