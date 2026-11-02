import { Router } from 'express'
import { PaymentsService } from './payments.service.js'
import { PaymentsController } from './payments.controller.js'
import { PaymentsCheckoutService } from './payments.checkout.js'
import { authenticate, requireMobileAuth } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PaymentsService(prisma)
const checkout = new PaymentsCheckoutService(prisma, service)
const controller = new PaymentsController(service, checkout)

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

/**
 * @openapi
 * /payments/receipts:
 *   get:
 *     tags: [Payments]
 *     summary: The caller's payment receipts for plan purchases, newest first
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: "{ success, data: [{ id, number, issuedAt, description, amount, currency }] }"
 */
router.get('/payments/receipts', authenticate, controller.listReceipts)

/**
 * @openapi
 * /payments/receipts/{receiptId}/download:
 *   get:
 *     tags: [Payments]
 *     summary: Short-lived link to download a receipt PDF
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: receiptId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: "{ success, data: { url, fileName } }. Open the url within a few minutes."
 *       404:
 *         description: Not found, or not the caller's receipt.
 */
router.get('/payments/receipts/:receiptId/download', authenticate, controller.downloadReceipt)

/**
 * @openapi
 * /payments/checkout-sessions:
 *   post:
 *     tags: [Payments]
 *     summary: Start a webview checkout (mobile app)
 *     description: >
 *       Mobile only. Creates (or reuses a recent unpaid) order for the plan and returns the URL the app opens in a
 *       webview. The URL carries a one-time token in its fragment (valid ~2 minutes); the app's own session id is
 *       never sent to the page. At most 10 per hour per member.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [communityId, planId]
 *             properties:
 *               communityId: { type: string, format: uuid }
 *               planId: { type: string, format: uuid }
 *     responses:
 *       201: { description: "{ checkoutUrl, expiresInSeconds }" }
 *       429: { description: Too many checkout attempts. }
 */
router.post('/payments/checkout-sessions', authenticate, requireMobileAuth, controller.createCheckoutSession)

/**
 * @openapi
 * /payments/checkout/exchange:
 *   post:
 *     tags: [Payments]
 *     summary: Trade the one-time token for a checkout session (webview page)
 *     description: >
 *       No login — the token is the credential. It works once; a second call gets 401. Returns the order to pay
 *       and a `sessionToken` for verify and status (send as `Authorization: Bearer`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200: { description: Order details and sessionToken. }
 *       401: { description: Token expired or already used. }
 */
router.post('/payments/checkout/exchange', controller.exchangeCheckoutToken)

/**
 * @openapi
 * /payments/checkout/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Confirm the payment from the webview page
 *     description: >
 *       Authorised by the checkout `sessionToken` (Bearer), which only reaches its own order. Safe to repeat: if
 *       the webhook already granted the plan, the same result is returned.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpayPaymentId, razorpaySignature]
 *             properties:
 *               razorpayPaymentId: { type: string }
 *               razorpaySignature: { type: string }
 *     responses:
 *       200: { description: Plan granted. }
 *       400: { description: Signature invalid (the order is left untouched). }
 *       401: { description: Session expired. }
 */
router.post('/payments/checkout/verify', controller.verifyCheckout)

/**
 * @openapi
 * /payments/checkout/status:
 *   get:
 *     tags: [Payments]
 *     summary: Whether the checkout's order has been paid
 *     description: Bearer `sessionToken`. Used after the Razorpay popup closes, in case the webhook granted the plan first.
 *     responses:
 *       200: { description: "{ status: created | paid | failed, validUntil? }" }
 *       401: { description: Session expired. }
 */
router.get('/payments/checkout/status', controller.checkoutStatus)

export default router
