import { Router } from 'express'
import { PostsService } from './posts.service.js'
import { PostsController } from './posts.controller.js'
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PostsService(prisma)
const controller = new PostsController(service)

const router = Router()

const admin = requireRole('admin')

// All routes require authentication
router.use(authenticate)

/**
 * @openapi
 * /posts:
 *   get:
 *     tags: [Posts]
 *     summary: List published posts (feed)
 *     description: >
 *       Which community's posts come back depends on caller and role:
 *
 *       - **Super admin** (unrestricted access): sees all communities, or one
 *         via `communityId`.
 *       - **Scoped admin**: `communityId` must be one they're granted access
 *         to (else 403 COMMUNITY_ACCESS_DENIED); omit it to see every
 *         community they're granted, merged.
 *       - **Member, web**: `communityId` is ignored — scoped to
 *         `selectedCommunityId` from their session (see POST
 *         /auth/select-community / POST /auth/mobile/select-community), or
 *         every community they're subscribed to if none is selected yet.
 *       - **Member, mobile app only**: may pass `communityId` explicitly to
 *         view one community directly, bypassing `selectedCommunityId`. This
 *         is checked live against the database (not the possibly-stale
 *         communityIds cached on the mobile session at login) — a 403
 *         SUBSCRIPTION_REQUIRED is returned if that subscription is missing
 *         or has expired since login.
 *
 *       Only `status: published` (drafts never appear here) and
 *       non-deleted posts are returned. Pinned posts (top 3 per community)
 *       always sort first, then by `publishedAt` in the requested `order`.
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - name: pageSize
 *         in: query
 *         schema: { type: integer, minimum: 1, maximum: 50, default: 20 }
 *       - name: communityId
 *         in: query
 *         description: >
 *           Admins: filter to one community. Members: honored only on mobile
 *           (see description above) and live-checked against an active
 *           subscription; ignored for web members.
 *         schema: { type: string, format: uuid }
 *       - name: date
 *         in: query
 *         description: Restrict to one calendar day, IST (Asia/Kolkata), not UTC.
 *         schema: { type: string, pattern: '^\d{4}-\d{2}-\d{2}$', example: "2026-09-09" }
 *       - name: order
 *         in: query
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *     responses:
 *       200:
 *         description: Paginated feed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     posts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           communityId: { type: string, format: uuid }
 *                           communityName: { type: string }
 *                           communitySlug: { type: string }
 *                           communityBadgeUrl: { type: string, nullable: true }
 *                           authorName: { type: string }
 *                           authorAvatarUrl: { type: string, nullable: true }
 *                           title: { type: string }
 *                           content: { type: string, description: "Markdown source." }
 *                           imageUrls: { type: array, items: { type: string } }
 *                           tags: { type: array, items: { type: string } }
 *                           pinOrder: { type: integer, nullable: true, minimum: 1, maximum: 3 }
 *                           publishedAt: { type: string, format: date-time, nullable: true }
 *                           createdAt: { type: string, format: date-time }
 *                           commentCount: { type: integer }
 *                     total: { type: integer }
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     totalPages: { type: integer }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: >
 *           Scoped admin requested a community outside their grant (code
 *           COMMUNITY_ACCESS_DENIED), or a mobile member has no active
 *           subscription to the requested community (code
 *           SUBSCRIPTION_REQUIRED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed (bad page/pageSize/communityId/date/order).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.get('/', controller.list)

router.get('/my-comments', controller.listCommented)

// Admin-only — requireRole applied inline so it doesn't bleed into comment routes
// that share the /api/v1/posts prefix (e.g. POST /api/v1/posts/:id/comments)
router.get('/upload-url', admin, controller.getUploadUrl)
router.post('/', admin, controller.create)
router.patch('/:id', admin, controller.update)
router.delete('/:id', admin, controller.delete)
router.patch('/:id/publish', admin, controller.publish)
router.patch('/:id/pin', admin, controller.pin)

export default router
