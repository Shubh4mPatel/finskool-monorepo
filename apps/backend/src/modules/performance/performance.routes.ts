import { Router } from 'express'
import prisma from '../../lib/prisma.js'
import { authenticate, requireMobileAuth, requireRole } from '../../middlewares/auth.middleware.js'
import { PerformanceController } from './performance.controller.js'
import { PerformanceService } from './performance.service.js'

const service = new PerformanceService(prisma)
const controller = new PerformanceController(service)

// ─── Web admin: /api/v1/admin/performance ───────────────────────────────────
// requireRole('admin') only gates the role. Which communities an admin may touch is checked per request in the
// service (assertCommunityAccessFromToken), and linking a board is super admin only.
const router = Router()
router.use(authenticate, requireRole('admin'))

router.get('/boards', controller.listBoards)
router.post('/boards', controller.createBoard)

router.get('/communities/:communityId/overview', controller.overview)
router.patch('/communities/:communityId/settings', controller.updateSettings)

router.get('/communities/:communityId/trades', controller.listTrades)
router.post('/communities/:communityId/trades', controller.createTrade)
router.patch('/communities/:communityId/trades/:tradeId', controller.updateTrade)
router.delete('/communities/:communityId/trades/:tradeId', controller.deleteTrade)
router.post('/communities/:communityId/import', controller.importTrades)

router.post('/communities/:communityId/periods', controller.createPeriod)
router.patch('/communities/:communityId/periods/:periodId', controller.updatePeriod)
router.delete('/communities/:communityId/periods/:periodId', controller.deletePeriod)

export default router

// ─── Mobile: /api/v1/mobile/performance ─────────────────────────────────────
// Read-only, MobileSession auth only. Any signed-in member may read it: a member without a subscription to the
// community is a "free" viewer and gets the admin-approved subset, not a 403.
export const mobilePerformanceRouter = Router()
mobilePerformanceRouter.use(authenticate, requireMobileAuth)

/**
 * @openapi
 * /mobile/performance/boards:
 *   get:
 *     tags: [Performance]
 *     summary: Communities that have a Performance screen
 *     description: >
 *       One entry per community with a Performance board, with the caller's access to it: `paid` when they hold an
 *       active, unexpired subscription to that community (checked live), otherwise `free`.
 *     responses:
 *       200:
 *         description: The boards.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     boards:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           communityId: { type: string, format: uuid }
 *                           name: { type: string }
 *                           slug: { type: string }
 *                           kind: { type: string, enum: [intraday, swing, investor] }
 *                           segments: { type: array, items: { type: string, enum: [main, investor, long_term, us_investment] } }
 *                           access: { type: string, enum: [free, paid] }
 *       401:
 *         description: Not signed in, or the session ended (`SESSION_INVALIDATED`).
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
mobilePerformanceRouter.get('/boards', controller.listBoardsMobile)

/**
 * @openapi
 * /mobile/performance/communities/{communityId}:
 *   get:
 *     tags: [Performance]
 *     summary: A community's trades and results
 *     description: >
 *       `summary` covers every trade in the segment and is the same for free and paid callers. `items` is every
 *       trade for a paid caller, and only the trades the admin allows for a free caller (`hiddenCount` says how many
 *       are held back; it is null for paid callers). Newest first, cursor-paginated.
 *     parameters:
 *       - { name: communityId, in: path, required: true, schema: { type: string, format: uuid } }
 *       - { name: segment, in: query, required: false, description: "Investor boards only: investor, long_term or us_investment.", schema: { type: string, enum: [main, investor, long_term, us_investment] } }
 *       - { name: month, in: query, required: false, description: "Only trades from this month (YYYY-MM). Does not change `summary`.", schema: { type: string, example: "2026-10" } }
 *       - { name: cursor, in: query, required: false, schema: { type: string } }
 *       - { name: limit, in: query, required: false, schema: { type: integer, minimum: 1, maximum: 50, default: 20 } }
 *     responses:
 *       200: { description: "Kind, access, summary, banner text, hiddenCount, items and nextCursor." }
 *       400: { description: "Bad segment or cursor (`INVALID_SEGMENT`, `INVALID_CURSOR`).", content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
 *       404: { description: "The community has no Performance board (`PERFORMANCE_BOARD_NOT_FOUND`).", content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
 */
mobilePerformanceRouter.get('/communities/:communityId', controller.getMobile)
