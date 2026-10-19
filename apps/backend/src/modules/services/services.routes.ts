import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { authenticate, requireMobileAuth, requireRole } from '../../middlewares/auth.middleware.js'
import { AdminServicesController } from './admin-services.controller.js'
import { AdminServicesService } from './admin-services.service.js'
import { ServicesController } from './services.controller.js'
import { ServicesService } from './services.service.js'

// ─── Web admin: /api/v1/admin/services ──────────────────────────────────────
// Support team inbox + chat + catalog. Services are global: any admin can see every request.
const admin = new AdminServicesController(new AdminServicesService(prisma))
const router = Router()
router.use(authenticate, requireRole('admin'))

// Static paths first so they aren't swallowed by /:requestId.
router.get('/stats', admin.stats)
router.post('/attachments/presign', admin.presign)
router.get('/catalog', admin.listCatalog)
router.post('/catalog', admin.createService)
router.post('/catalog/image/presign', admin.catalogImagePresign)
router.patch('/catalog/:serviceId', admin.updateService)
router.delete('/catalog/:serviceId', admin.deleteService)
router.get('/', admin.list)
router.get('/:requestId', admin.get)
router.post('/:requestId/claim', admin.claim)
router.post('/:requestId/reassign', admin.reassign)
router.post('/:requestId/close', admin.close)
router.get('/:requestId/attachments/:attachmentId/url', admin.attachmentUrl)

export default router

// ─── Mobile: /api/v1/mobile/services ────────────────────────────────────────
// Members request and chat about services from the mobile app only (MobileSession auth).
// Chat (send / history / read) runs over the /ws/tickets WebSocket — see tickets.socket.ts.
const member = new ServicesController(new ServicesService(prisma))
export const mobileServicesRouter = Router()
mobileServicesRouter.use(authenticate, requireMobileAuth)

/**
 * @openapi
 * /mobile/services/catalog:
 *   get:
 *     tags: [Services]
 *     summary: Services a member can request
 *     description: Every active service (the catalog is global, not per community).
 *     responses:
 *       200:
 *         description: "`data`: array of `{ id, title, description, imageUrl }`."
 */
mobileServicesRouter.get('/catalog', member.catalog)

/**
 * @openapi
 * /mobile/services/attachments/presign:
 *   post:
 *     tags: [Services]
 *     summary: Get a presigned URL to upload one attachment
 *     description: >
 *       Same rules as support tickets: JPG / PNG / WebP / PDF, max 5 MB each, up to 5 per request or
 *       message. PUT the raw bytes to `uploadUrl` (valid 5 min), then pass `{ objectKey, fileName }`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, sizeBytes]
 *             properties:
 *               fileName: { type: string, example: portfolio.pdf }
 *               sizeBytes: { type: integer, maximum: 5242880 }
 *     responses:
 *       200:
 *         description: "`data`: `{ uploadUrl, objectKey }`."
 */
mobileServicesRouter.post('/attachments/presign', member.presign)

/**
 * @openapi
 * /mobile/services/unread-count:
 *   get:
 *     tags: [Services]
 *     summary: Total unread admin replies across the member's service requests (app badge)
 *     responses:
 *       200:
 *         description: "`data`: `{ unreadCount }`."
 */
mobileServicesRouter.get('/unread-count', member.unreadTotal)

/**
 * @openapi
 * /mobile/services:
 *   post:
 *     tags: [Services]
 *     summary: Request a service
 *     description: >
 *       Requires an `Idempotency-Key` header (fresh UUID per form submission, reused on retry): a repeated
 *       key returns the original request. A member can have only one open request per service.
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: true
 *         schema: { type: string, minLength: 8, maxLength: 64 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [serviceId, needs]
 *             properties:
 *               serviceId: { type: string, format: uuid }
 *               needs: { type: string, maxLength: 2000 }
 *               attachments:
 *                 type: array
 *                 maxItems: 5
 *                 items:
 *                   type: object
 *                   properties:
 *                     objectKey: { type: string }
 *                     fileName: { type: string }
 *     responses:
 *       201: { description: "Created (or the original, on a repeated key). `data` is the request." }
 *       400: { description: IDEMPOTENCY_KEY_REQUIRED or ATTACHMENT_INVALID. }
 *       403: { description: ACCOUNT_INACTIVE. }
 *       404: { description: Service not found or not active. }
 *       409: { description: SERVICE_REQUEST_ALREADY_OPEN. }
 *   get:
 *     tags: [Services]
 *     summary: List my service requests (most recently active first)
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [requested, quote_sent, paid, closed] } }
 *       - { in: query, name: cursor, schema: { type: string } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200: { description: "`data`: `{ items: ServiceRequest[], nextCursor }`." }
 */
mobileServicesRouter.post('/', member.create)
mobileServicesRouter.get('/', member.list)

/**
 * @openapi
 * /mobile/services/{requestId}:
 *   get:
 *     tags: [Services]
 *     summary: Service request detail
 *     parameters:
 *       - { in: path, name: requestId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The request. }
 *       404: { description: Not found / not yours. }
 */
mobileServicesRouter.get('/:requestId', member.get)

/**
 * @openapi
 * /mobile/services/{requestId}/cancel:
 *   post:
 *     tags: [Services]
 *     summary: Cancel a request before paying
 *     parameters:
 *       - { in: path, name: requestId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The closed request (`closedReason: cancelled_by_member`). }
 *       409: { description: SERVICE_CLOSED or SERVICE_NOT_CANCELLABLE (already paid). }
 */
mobileServicesRouter.post('/:requestId/cancel', member.cancel)

/**
 * @openapi
 * /mobile/services/{requestId}/rating:
 *   post:
 *     tags: [Services]
 *     summary: Rate a completed service (once, final)
 *     parameters:
 *       - { in: path, name: requestId, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 1000 }
 *     responses:
 *       200: { description: The updated request. }
 *       409: { description: SERVICE_NOT_COMPLETED or ALREADY_RATED. }
 */
mobileServicesRouter.post('/:requestId/rating', member.rate)

/**
 * @openapi
 * /mobile/services/{requestId}/attachments/{attachmentId}/url:
 *   get:
 *     tags: [Services]
 *     summary: Fresh download URL for an attachment (when an earlier signed URL expired)
 *     parameters:
 *       - { in: path, name: requestId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: attachmentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "`data`: `{ url }`." }
 */
mobileServicesRouter.get('/:requestId/attachments/:attachmentId/url', member.attachmentUrl)
