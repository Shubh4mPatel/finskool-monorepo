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

/**
 * @openapi
 * /posts/my-comments:
 *   get:
 *     tags: [Posts]
 *     summary: List posts the current user has commented on
 *     description: >
 *       Not paginated — every non-deleted post the caller has a non-deleted
 *       comment on, across all their communities, newest-commented first.
 *     responses:
 *       200:
 *         description: List of posts, each with an added lastCommentedAt.
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
 *                       communityId: { type: string, format: uuid }
 *                       communityName: { type: string }
 *                       communitySlug: { type: string }
 *                       communityBadgeUrl: { type: string, nullable: true }
 *                       authorName: { type: string }
 *                       authorAvatarUrl: { type: string, nullable: true }
 *                       title: { type: string }
 *                       content: { type: string }
 *                       imageUrls: { type: array, items: { type: string } }
 *                       tags: { type: array, items: { type: string } }
 *                       pinOrder: { type: integer, nullable: true }
 *                       publishedAt: { type: string, format: date-time, nullable: true }
 *                       createdAt: { type: string, format: date-time }
 *                       commentCount: { type: integer }
 *                       lastCommentedAt: { type: string, format: date-time }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.get('/my-comments', controller.listCommented)

// Admin-only — requireRole applied inline so it doesn't bleed into comment routes
// that share the /api/v1/posts prefix (e.g. POST /api/v1/posts/:id/comments)

/**
 * @openapi
 * /posts/upload-url:
 *   get:
 *     tags: [Posts]
 *     summary: Get a pre-signed MinIO upload URL for a post image
 *     description: >
 *       Admin-only. Upload the file directly to the returned `uploadUrl` from
 *       the client (PUT), then pass the resulting public URL in `imageUrls`
 *       on create/update — this endpoint doesn't touch the post itself.
 *     parameters:
 *       - name: filename
 *         in: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pre-signed URL issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     uploadUrl: { type: string, description: "Pre-signed PUT URL, short-lived." }
 *                     publicUrl: { type: string, description: "Public URL to store in imageUrls once uploaded." }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Missing filename.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.get('/upload-url', admin, controller.getUploadUrl)

/**
 * @openapi
 * /posts:
 *   post:
 *     tags: [Posts]
 *     summary: Create a post
 *     description: >
 *       Admin-only. Created as `draft` — invisible in GET /posts until
 *       PATCH /posts/{id}/publish is called. Caller must have access to
 *       `communityId` (unrestricted for super admins, granted-set-only for
 *       scoped admins — 403 COMMUNITY_ACCESS_DENIED otherwise).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [communityId, title, content]
 *             properties:
 *               communityId: { type: string, format: uuid }
 *               title: { type: string, maxLength: 300 }
 *               content: { type: string, description: "Markdown source." }
 *               tags: { type: array, items: { type: string, maxLength: 50 }, default: [] }
 *               imageUrls: { type: array, items: { type: string, format: uri }, default: [] }
 *     responses:
 *       201:
 *         description: Draft created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     communityId: { type: string, format: uuid }
 *                     authorId: { type: string, format: uuid }
 *                     title: { type: string }
 *                     content: { type: string }
 *                     imageUrls: { type: array, items: { type: string } }
 *                     tags: { type: array, items: { type: string } }
 *                     status: { type: string, enum: [draft, published] }
 *                     pinOrder: { type: integer, nullable: true }
 *                     publishedAt: { type: string, format: date-time, nullable: true }
 *                     createdAt: { type: string, format: date-time }
 *                     updatedAt: { type: string, format: date-time }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin, or no access to this community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Community not found.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.post('/', admin, controller.create)

/**
 * @openapi
 * /posts/{id}:
 *   patch:
 *     tags: [Posts]
 *     summary: Update a post
 *     description: >
 *       Admin-only, and only within a community the caller has access to.
 *       Partial update — omit fields to leave them unchanged. If `imageUrls`
 *       is provided, any URL dropped from the previous list is deleted from
 *       MinIO.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string, maxLength: 300 }
 *               content: { type: string }
 *               tags: { type: array, items: { type: string, maxLength: 50 } }
 *               imageUrls: { type: array, items: { type: string, format: uri } }
 *     responses:
 *       200:
 *         description: Updated post.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Same shape as POST /posts's response." }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin, or no access to this post's community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found (or already deleted).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
router.patch('/:id', admin, controller.update)

/**
 * @openapi
 * /posts/{id}:
 *   delete:
 *     tags: [Posts]
 *     summary: Delete a post
 *     description: >
 *       Admin-only. Soft delete (sets deletedAt) — the row isn't removed. If
 *       the post was pinned, every other pinned post in the community below
 *       its slot is compacted up by one so pin slots stay contiguous.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Deleted.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Post deleted" }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin, or no access to this post's community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found (or already deleted).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.delete('/:id', admin, controller.delete)

/**
 * @openapi
 * /posts/{id}/publish:
 *   patch:
 *     tags: [Posts]
 *     summary: Publish a draft post
 *     description: >
 *       Admin-only. Sets status to `published` and `publishedAt` to now, then
 *       enqueues a fan-out notification to every subscriber of the post's
 *       community (best-effort — a queue/Redis outage is logged, not raised,
 *       since the publish itself already succeeded).
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Published post.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Same shape as POST /posts's response, status now 'published'." }
 *       400:
 *         description: Post is already published.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin, or no access to this post's community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found (or already deleted).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.patch('/:id/publish', admin, controller.publish)

/**
 * @openapi
 * /posts/{id}/pin:
 *   patch:
 *     tags: [Posts]
 *     summary: Toggle pin on a post
 *     description: >
 *       Admin-only. No separate pin/unpin endpoint — this toggles based on
 *       the post's current pinOrder. Pinning always inserts at slot 1,
 *       pushing every other pinned post in the community down one slot;
 *       whatever falls past slot 3 is evicted (fully unpinned). Unpinning
 *       clears the slot and compacts the posts below it up by one, so pin
 *       slots stay contiguous (1..N, N <= 3).
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated post, with its new pinOrder (null if just unpinned).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, description: "Same shape as POST /posts's response." }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: Not an admin, or no access to this post's community (code COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found (or already deleted).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.patch('/:id/pin', admin, controller.pin)

export default router
