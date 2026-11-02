import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../../lib/prisma.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import { BadRequestError } from '../../shared/errors/index.js'
import { getReceiptDownloadUrlForAdmin, listReceiptsForAdmin } from '../../lib/plan-receipt.js'

// /api/v1/admin/receipts: plan-purchase receipts for admins. Which members an admin may see follows the member
// profile rule (a subscription in a community they manage; super admins see everyone).
const router = Router()
router.use(authenticate, requireRole('admin'))

const uuid = z.string().uuid()
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next)
}

/**
 * @openapi
 * /admin/receipts:
 *   get:
 *     tags: [Payments]
 *     summary: A member's plan-purchase receipts (newest first)
 *     parameters:
 *       - { in: query, name: userId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: [{ id, number, issuedAt, description, amount, currency }] }" }
 *       403: { description: The admin has no access to this member (MEMBER_ACCESS_DENIED). }
 */
router.get('/', wrap(async (req, res) => {
  const userId = uuid.safeParse(req.query['userId'])
  if (!userId.success) throw new BadRequestError('userId is required')
  res.json({ success: true, data: await listReceiptsForAdmin(prisma, req.user!.accessibleCommunityIds, userId.data) })
}))

/**
 * @openapi
 * /admin/receipts/{receiptId}/download:
 *   get:
 *     tags: [Payments]
 *     summary: Short-lived link to download a receipt PDF
 *     parameters:
 *       - { in: path, name: receiptId, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: "{ success, data: { url, fileName } }" }
 *       403: { description: No access to this member. }
 *       404: { description: Receipt not found. }
 */
router.get('/:receiptId/download', wrap(async (req, res) => {
  const id = uuid.safeParse(req.params['receiptId'])
  if (!id.success) throw new BadRequestError('Invalid receiptId')
  res.json({ success: true, data: await getReceiptDownloadUrlForAdmin(prisma, req.user!.accessibleCommunityIds, id.data) })
}))

export default router
