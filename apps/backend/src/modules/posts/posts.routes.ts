import { Router } from 'express'
import { PostsService } from './posts.service.js'
import { PostsController } from './posts.controller.js'
import { mobileFeedCommunity } from './posts.middleware.js'
import { receiveMediaFiles } from './posts.upload.js'
import { authenticate, requireRole, requireMobileAuth } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new PostsService(prisma)
const controller = new PostsController(service)

const router = Router()

const admin = requireRole('admin')

// All routes require authentication
router.use(authenticate)

router.get('/', controller.list)
router.get('/my-comments', controller.listCommented)

// Admin-only — requireRole applied inline so it doesn't bleed into comment routes
// that share the /api/v1/posts prefix (e.g. POST /api/v1/posts/:id/comments)
router.get('/upload-url', admin, controller.getUploadUrl)
/**
 * @openapi
 * /posts/media:
 *   post:
 *     tags: [Posts]
 *     summary: Upload post images and videos (admin)
 *     description: >
 *       multipart/form-data, field `files` (up to 10 per request). Images (JPG, PNG, WebP, GIF, up to 10 MB) and
 *       videos (MP4, MOV, up to 50 MB) are checked by content, stored as uploaded, and measured: the response gives each
 *       file's real displayed width/height, ratio (width / height) and orientation (`portrait` when taller than wide,
 *       otherwise `landscape`). A video also gets a poster frame (`thumbnailUrl`). Put the returned `url`s in
 *       `imageUrls` / `videos` when creating or updating a post; sizes are read again from the stored files on save.
 *     responses:
 *       201: { description: One entry per file, in the order sent. }
 *       400: { description: A file is too big, not a supported type, or cannot be decoded. }
 */
router.post('/media', admin, receiveMediaFiles, controller.uploadMedia)
router.post('/video-preview', admin, controller.videoPreview)
router.post('/', admin, controller.create)
router.patch('/:id', admin, controller.update)
router.delete('/:id', admin, controller.delete)
router.patch('/:id/publish', admin, controller.publish)
router.patch('/:id/pin', admin, controller.pin)

export default router

// Mounted separately at /api/v1/mobile — the mobile app's own feed endpoint,
// gated to MobileSession auth only (see requireMobileAuth). Its community
// scoping (explicit communityId, free feed by default) differs from the
// unprefixed GET /api/v1/posts above, which the admin website keeps using.
export const mobilePostsRouter = Router()
mobilePostsRouter.use(authenticate, requireMobileAuth)

/**
 * @openapi
 * /mobile/posts:
 *   get:
 *     tags: [Posts]
 *     summary: List published posts (feed)
 *     description: >
 *       Mobile-only (403 MOBILE_ONLY for a web JWT). The feed is always for
 *       exactly one community:
 *
 *       - **`communityId` omitted** — the free community's posts. Empty page
 *         if no free community exists.
 *       - **`communityId` given** — that community's posts.
 *
 *       Access is checked live against the database on every call, for the
 *       free community too: a member needs an active, unexpired subscription
 *       to the requested community (else 403 SUBSCRIPTION_REQUIRED). Every
 *       account gets a free-community subscription at registration, or at its
 *       first login if it predates that. Admins can always read the free
 *       community, and need a grant for a paid one (else 403
 *       COMMUNITY_ACCESS_DENIED; super admins can use any).
 *
 *       Get community ids from `GET /mobile/communities` (paid) or the
 *       `communities` returned by login. Only `status: published` and
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
 *           Community to show. Omit for the free community's feed. The caller
 *           must have access to it (see description above).
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
 *                           images:
 *                             type: array
 *                             description: Every image with its real size, in display order. width/height/ratio/orientation are null only for an image of an old post that has not been re-saved yet.
 *                             items:
 *                               type: object
 *                               properties:
 *                                 url: { type: string }
 *                                 width: { type: integer, nullable: true }
 *                                 height: { type: integer, nullable: true }
 *                                 ratio: { type: number, nullable: true, description: "width / height, e.g. 1.7778 (16:9) or 0.8 (4:5)." }
 *                                 orientation: { type: string, nullable: true, enum: [portrait, landscape] }
 *                           ratio: { type: number, nullable: true, description: "The post's media ratio (width / height), from its first image, else its first uploaded video. Null when the post has no sized media (none, only YouTube/Instagram links, or an old post). Files are stored as uploaded, never cropped: lay them out with this." }
 *                           orientation: { type: string, nullable: true, enum: [portrait, landscape], description: "portrait when taller than wide; a square is landscape. Null with ratio." }
 *                           mediaWidth: { type: integer, nullable: true }
 *                           mediaHeight: { type: integer, nullable: true }
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
 *           A member has no active, unexpired subscription to the requested
 *           community (code SUBSCRIPTION_REQUIRED), an admin has no grant for
 *           the requested paid community (code COMMUNITY_ACCESS_DENIED), or the
 *           caller isn't on a mobile session (code MOBILE_ONLY).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: No such community (or it was deleted).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed (bad page/pageSize/communityId/date/order).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 */
mobilePostsRouter.get('/posts', mobileFeedCommunity(service), controller.listMobile)
