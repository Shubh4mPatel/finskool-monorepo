import { Router } from 'express'
import type { Request } from 'express'
import prisma from '../../lib/prisma.js'
import { ServicePaymentsService } from './services.payments.js'

declare global {
  namespace Express {
    interface Request {
      // The exact bytes of the request body, kept by the JSON parser for routes that verify a signature over them.
      rawBody?: Buffer
    }
  }
}

/** Paths whose raw body must be kept (see app.ts). */
export const RAW_BODY_PATH_PREFIX = '/api/v1/payments/webhooks/'

const payments = new ServicePaymentsService(prisma)

// Mounted at /api/v1/payments/webhooks. No login: Razorpay calls it, and the HMAC signature over the
// raw body is the authentication.
const router = Router()

/**
 * @openapi
 * /payments/webhooks/razorpay:
 *   post:
 *     tags: [Services]
 *     summary: Razorpay webhook (server to server)
 *     description: >
 *       Configure in the Razorpay dashboard with the secret in RAZORPAY_WEBHOOK_SECRET and events
 *       `order.paid`, `payment.captured`, `payment.failed`. Confirms service payments independently of
 *       the app's verify call. Events for orders that are not service quotes (e.g. plan purchases) are
 *       acknowledged and ignored.
 *     responses:
 *       200: { description: Accepted (also for duplicates and ignored events). }
 *       400: { description: Bad signature or body. }
 *       500: { description: Processing failed; Razorpay will retry. }
 */
router.post('/razorpay', async (req: Request, res, next) => {
  try {
    const raw = req.rawBody
    if (!raw) {
      res.status(400).json({ success: false, message: 'Missing body' })
      return
    }
    const { status, message } = await payments.handleWebhook(
      raw,
      req.header('X-Razorpay-Signature') ?? '',
      req.header('X-Razorpay-Event-Id') ?? undefined,
    )
    res.status(status).json({ success: status < 300, message })
  } catch (err) {
    next(err)
  }
})

export default router
