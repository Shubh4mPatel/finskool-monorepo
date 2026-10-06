import { Router } from 'express'
import { WelcomeKitsService } from './welcome-kits.service.js'
import { WelcomeKitsController } from './welcome-kits.controller.js'
import { authenticate, requireRole, requireMobileAuth } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new WelcomeKitsService(prisma)
const controller = new WelcomeKitsController(service)

const admin = requireRole('admin')

// Mounted at /api/v1/admin (alongside adminRoutes). Middleware is applied per route, not
// router-wide, so it never touches the other /api/v1/admin/* routes this router doesn't own.
const router = Router()

/**
 * @openapi
 * /admin/welcome-kits:
 *   get:
 *     tags: [Welcome Kit]
 *     summary: Paid communities the admin can manage a welcome kit for
 *     description: >
 *       Every live, paid (non-free) community the admin has access to, with whether it already has a kit.
 *       Super admins see all; other admins only their granted communities.
 *     responses:
 *       200:
 *         description: List of communities.
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
 *                       communityId: { type: string, format: uuid }
 *                       name: { type: string }
 *                       slug: { type: string }
 *                       type: { type: string, nullable: true, example: "Short Term Investment" }
 *                       coverImageUrl: { type: string, nullable: true }
 *                       badgeUrl: { type: string, nullable: true }
 *                       hasKit: { type: boolean }
 *                       updatedAt: { type: string, format: date-time, nullable: true }
 */
router.get('/welcome-kits', authenticate, admin, controller.list)

/**
 * @openapi
 * /admin/communities/{communityId}/welcome-kit:
 *   get:
 *     tags: [Welcome Kit]
 *     summary: Get a community's welcome kit (for editing)
 *     description: >
 *       Returns the kit, or `data: null` if none has been added yet. Lists are sorted by `priority`.
 *       400 for the free community, 404 for an unknown/deleted community, 403 without access to it.
 *     parameters:
 *       - { name: communityId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: The kit or null. }
 *   put:
 *     tags: [Welcome Kit]
 *     summary: Create or replace a community's welcome kit
 *     description: >
 *       Full replace. Send each list in display order — the server assigns `priority` 1..n.
 *       `youtubeUrls` must be YouTube video links (stored in canonical form, no duplicates).
 *       Limits: intro 5000 chars; 5 videos; 10 strategies; 5 notices; 15 "what you get" items.
 *     parameters:
 *       - { name: communityId, in: path, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               watchBeforeYouStart:
 *                 type: object
 *                 properties:
 *                   introMarkdown: { type: string }
 *                   youtubeUrls: { type: array, items: { type: string } }
 *               capitalAllocation:
 *                 type: object
 *                 properties:
 *                   heroStat: { type: string, example: "₹50,000" }
 *                   description: { type: string }
 *                   strategyTitle: { type: string, example: "Strategy at a glance" }
 *                   strategies:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         value: { type: string, example: "3" }
 *                         label: { type: string, example: "Recommendations per week" }
 *               strategyNotices:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type: { type: string, enum: [normal, warning] }
 *                     heading: { type: string }
 *                     description: { type: string }
 *               whatYouGet:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     text: { type: string }
 *     responses:
 *       200: { description: The saved kit. }
 *       400: { description: Validation failed, invalid YouTube link, or free community. }
 *   delete:
 *     tags: [Welcome Kit]
 *     summary: Delete a community's welcome kit
 *     parameters:
 *       - { name: communityId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200: { description: Deleted. }
 *       404: { description: The community has no kit. }
 */
router.get('/communities/:communityId/welcome-kit', authenticate, admin, controller.get)
router.put('/communities/:communityId/welcome-kit', authenticate, admin, controller.upsert)
router.delete('/communities/:communityId/welcome-kit', authenticate, admin, controller.remove)

export default router

// Mounted at /api/v1/mobile — the mobile app's read-only view (MobileSession auth only).
export const mobileWelcomeKitsRouter = Router()
mobileWelcomeKitsRouter.use(authenticate, requireMobileAuth)

/**
 * @openapi
 * /mobile/communities/{communityId}/welcome-kit:
 *   get:
 *     tags: [Welcome Kit]
 *     summary: A paid community's welcome kit
 *     description: >
 *       Mobile-only (403 MOBILE_ONLY for a web JWT). Members need an active, unexpired subscription to the
 *       community (else 403 SUBSCRIPTION_REQUIRED); admins need access to it. 404 if the community has no
 *       kit yet, or is the free community. Lists are sorted by `priority`. `introMarkdown`,
 *       `capitalAllocation.description`, each notice's `description` and each `whatYouGet` text are
 *       raw markdown (bold, italic, lists, links) — render them as markdown.
 *       Each video carries a ready-to-use `embedUrl` and `thumbnailUrl`.
 *     parameters:
 *       - { name: communityId, in: path, required: true, schema: { type: string, format: uuid } }
 *     responses:
 *       200:
 *         description: The welcome kit.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     communityId: { type: string, format: uuid }
 *                     communityName: { type: string }
 *                     watchBeforeYouStart:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         introMarkdown: { type: string }
 *                         videos:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               url: { type: string }
 *                               videoId: { type: string }
 *                               embedUrl: { type: string }
 *                               thumbnailUrl: { type: string, nullable: true }
 *                     capitalAllocation:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         heroStat: { type: string }
 *                         description: { type: string }
 *                         strategyTitle: { type: string }
 *                         strategies:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               priority: { type: integer }
 *                               value: { type: string }
 *                               label: { type: string }
 *                     strategyNotices:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           priority: { type: integer }
 *                           type: { type: string, enum: [normal, warning] }
 *                           heading: { type: string }
 *                           description: { type: string }
 *                     whatYouGet:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           priority: { type: integer }
 *                           text: { type: string }
 *                     updatedAt: { type: string, format: date-time }
 *       403: { description: Not subscribed (SUBSCRIPTION_REQUIRED), no admin access, or not a mobile session (MOBILE_ONLY). }
 *       404: { description: No kit for this community. }
 */
mobileWelcomeKitsRouter.get('/communities/:communityId/welcome-kit', controller.getMobile)
