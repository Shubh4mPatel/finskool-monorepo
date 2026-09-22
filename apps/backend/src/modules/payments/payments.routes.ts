import { Router } from 'express'
import { PaymentsService } from './payments.service.js'
import { PaymentsController } from './payments.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PaymentsService(prisma)
const controller = new PaymentsController(service)

const router = Router()

// mounted at /api/v1 — full paths defined here, same pattern as
// reactionsRoutes/commentsRoutes (deliberately overlapping the
// /communities URL space defined inline in app.ts).

/**
 * @openapi
 * /communities/{communityId}/plans:
 *   get:
 *     tags: [Payments]
 *     summary: List a community's purchasable plans
 *     description: Non-deleted plans for a non-free community, cheapest duration first. Always empty for the free community.
 *     parameters:
 *       - in: path
 *         name: communityId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Plans for this community.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       name: { type: string, example: "3 Month" }
 *                       durationMonths: { type: integer, example: 3 }
 *                       price: { type: number, example: 999 }
 *       404:
 *         description: Community not found.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.get('/communities/:communityId/plans', authenticate, controller.listPlans)

/**
 * @openapi
 * /communities/{communityId}/plans/{planId}/orders:
 *   post:
 *     tags: [Payments]
 *     summary: Create a Razorpay order to buy a plan
 *     description: >
 *       Creates a Razorpay order for the plan's price and records a pending
 *       PlanOrder row. Open Razorpay Checkout on the client with the returned
 *       orderId/amount/currency/keyId, then call POST /payments/verify with
 *       the result.
 *     parameters:
 *       - in: path
 *         name: communityId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: planId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Order created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string, example: "order_ABC123" }
 *                     amount: { type: integer, description: Smallest currency unit (paise), example: 99900 }
 *                     currency: { type: string, example: INR }
 *                     keyId: { type: string, description: Razorpay public key id }
 *                     planId: { type: string, format: uuid }
 *                     communityId: { type: string, format: uuid }
 *       400:
 *         description: The free community has no purchasable plans.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Community or plan not found.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.post('/communities/:communityId/plans/:planId/orders', authenticate, controller.createOrder)

/**
 * @openapi
 * /payments/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Verify a Razorpay payment and activate the subscription
 *     description: >
 *       Verifies the Checkout signature server-side, then creates a new
 *       active Subscription (or extends the caller's current one for that
 *       community, starting from its current validUntil if it hasn't
 *       expired yet — buying early never costs remaining days) and marks the
 *       order paid. Idempotent per order: calling this twice for an
 *       already-paid order returns 409.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpayOrderId, razorpayPaymentId, razorpaySignature]
 *             properties:
 *               razorpayOrderId: { type: string }
 *               razorpayPaymentId: { type: string }
 *               razorpaySignature: { type: string }
 *     responses:
 *       200:
 *         description: Payment verified, subscription active.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     subscriptionId: { type: string, format: uuid }
 *                     communityId: { type: string, format: uuid }
 *                     planId: { type: string, format: uuid }
 *                     payment: { type: number }
 *                     validUntil: { type: string, example: "2027-03-22" }
 *                     isActive: { type: boolean, example: true }
 *       400:
 *         description: Signature verification failed (code PAYMENT_SIGNATURE_INVALID).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Order not found for this caller.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       409:
 *         description: Order already processed (code ORDER_ALREADY_PAID).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/payments/verify', authenticate, controller.verifyPayment)

export default router
