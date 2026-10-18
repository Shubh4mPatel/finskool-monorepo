import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { authenticate, requireMobileAuth, requireRole } from '../../middlewares/auth.middleware.js'
import { TicketsService } from './tickets.service.js'
import { TicketsController } from './tickets.controller.js'
import { AdminTicketsService } from './admin-tickets.service.js'
import { AdminTicketsController } from './admin-tickets.controller.js'

// ─── Web admin: /api/v1/admin/tickets ───────────────────────────────────────
// Support team inbox + chat. requireRole('admin') only gates the role; which tickets an
// admin can actually see/act on is enforced per community inside AdminTicketsService.
const admin = new AdminTicketsController(new AdminTicketsService(prisma))
const router = Router()
router.use(authenticate, requireRole('admin'))

// Static paths first so they aren't swallowed by /:ticketId.
router.get('/stats', admin.stats)
router.post('/attachments/presign', admin.presign)
router.get('/', admin.list)
router.get('/:ticketId', admin.get)
router.post('/:ticketId/claim', admin.claim)
router.post('/:ticketId/reassign', admin.reassign)
router.post('/:ticketId/resolve', admin.resolve)
router.get('/:ticketId/attachments/:attachmentId/url', admin.attachmentUrl)

export default router

// ─── Mobile: /api/v1/mobile/tickets ─────────────────────────────────────────
// Users raise and chat on tickets from the mobile app only (MobileSession auth).
const user = new TicketsController(new TicketsService(prisma))
export const mobileTicketsRouter = Router()
mobileTicketsRouter.use(authenticate, requireMobileAuth)

/**
 * @openapi
 * /mobile/tickets/communities:
 *   get:
 *     tags: [Support Tickets]
 *     summary: Communities the user can raise a ticket against
 *     description: Every community the user holds or ever held a subscription for (free community included). Feeds the community picker on the "raise ticket" form.
 *     responses:
 *       200:
 *         description: "`data`: array of `{ id, name, isFree }`."
 */
mobileTicketsRouter.get('/communities', user.communities)

/**
 * @openapi
 * /mobile/tickets/attachments/presign:
 *   post:
 *     tags: [Support Tickets]
 *     summary: Get a presigned URL to upload one attachment
 *     description: >
 *       Images (jpg/png/webp) or PDF, max 5 MB each, up to 5 per ticket/message. PUT the raw file bytes to
 *       `uploadUrl` (valid 5 min), then pass `{ objectKey, fileName }` in the `attachments` array of
 *       create-ticket / send-message. The server verifies size and real file type on use, so a spoofed
 *       extension is rejected with `ATTACHMENT_INVALID`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fileName, sizeBytes]
 *             properties:
 *               fileName: { type: string, example: screenshot.png }
 *               sizeBytes: { type: integer, maximum: 5242880 }
 *     responses:
 *       200:
 *         description: "`data`: `{ uploadUrl, objectKey }`."
 *       400: { description: Unsupported file type (ATTACHMENT_INVALID). }
 *       422: { description: File larger than 5 MB. }
 */
mobileTicketsRouter.post('/attachments/presign', user.presign)

/**
 * @openapi
 * /mobile/tickets/unread-count:
 *   get:
 *     tags: [Support Tickets]
 *     summary: Total unread admin replies across all of the user's tickets (app badge)
 *     responses:
 *       200:
 *         description: "`data`: `{ unreadCount }`."
 */
mobileTicketsRouter.get('/unread-count', user.unreadTotal)

/**
 * @openapi
 * /mobile/tickets:
 *   post:
 *     tags: [Support Tickets]
 *     summary: Raise a ticket
 *     description: >
 *       Requires an `Idempotency-Key` header (a fresh UUID per form submission, reused on retry): a repeated
 *       key returns the original ticket instead of creating a second. Disable the submit button while the
 *       request is in flight as well.
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
 *             required: [communityId, category, type, subject, description]
 *             properties:
 *               communityId: { type: string, format: uuid }
 *               category: { type: string, enum: [payments, subscription, account, content, app_bug, other] }
 *               type: { type: string, enum: [issue, question, feature_request, refund_request] }
 *               subject: { type: string, maxLength: 150 }
 *               description: { type: string, maxLength: 2000 }
 *               attachments:
 *                 type: array
 *                 maxItems: 5
 *                 items:
 *                   type: object
 *                   properties:
 *                     objectKey: { type: string }
 *                     fileName: { type: string }
 *     responses:
 *       201: { description: "Created (or the original, on a repeated Idempotency-Key). `data` is the ticket." }
 *       400: { description: COMMUNITY_NOT_ALLOWED, ATTACHMENT_INVALID or IDEMPOTENCY_KEY_REQUIRED. }
 *       403: { description: ACCOUNT_INACTIVE. }
 *   get:
 *     tags: [Support Tickets]
 *     summary: List my tickets (most recently active first)
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [open, in_progress, resolved] } }
 *       - { in: query, name: cursor, schema: { type: string }, description: "`nextCursor` from the previous page." }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 50 } }
 *     responses:
 *       200: { description: "`data`: `{ items: Ticket[], nextCursor }`. Each ticket has `unreadCount`." }
 */
mobileTicketsRouter.post('/', user.create)
mobileTicketsRouter.get('/', user.list)

/**
 * @openapi
 * /mobile/tickets/{ticketId}:
 *   get:
 *     tags: [Support Tickets]
 *     summary: Ticket detail
 *     parameters:
 *       - { in: path, name: ticketId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The ticket (status, assignedAdminName, rating, description attachments with signed URLs). }
 *       404: { description: Not found / not yours. }
 */
mobileTicketsRouter.get('/:ticketId', user.get)

// Chat (send / history / read) is NOT on REST: it runs over the /ws/tickets WebSocket
// (message.send, history.get, ticket.read) — see modules/tickets/tickets.socket.ts.

/**
 * @openapi
 * /mobile/tickets/{ticketId}/rating:
 *   post:
 *     tags: [Support Tickets]
 *     summary: Rate a resolved ticket (once, final)
 *     parameters:
 *       - { in: path, name: ticketId, required: true, schema: { type: string, format: uuid } }
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
 *       200: { description: The updated ticket. }
 *       409: { description: TICKET_NOT_RESOLVED or ALREADY_RATED. }
 */
mobileTicketsRouter.post('/:ticketId/rating', user.rate)

/**
 * @openapi
 * /mobile/tickets/{ticketId}/attachments/{attachmentId}/url:
 *   get:
 *     tags: [Support Tickets]
 *     summary: Fresh download URL for an attachment (when an earlier signed URL expired)
 *     parameters:
 *       - { in: path, name: ticketId, required: true, schema: { type: string, format: uuid } }
 *       - { in: path, name: attachmentId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "`data`: `{ url }`." }
 */
mobileTicketsRouter.get('/:ticketId/attachments/:attachmentId/url', user.attachmentUrl)
