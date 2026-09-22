import express from 'express'
import type { CorsOptions } from 'cors'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import swaggerUi from 'swagger-ui-express'
import { env } from './config/env.js'
import { swaggerSpec, swaggerDocsPath } from './config/swagger.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { NotFoundError } from './shared/errors/index.js'
import authRoutes from './modules/auth/auth.routes.js'
import mobileAuthRoutes from './modules/mobile-auth/mobile-auth.routes.js'
import adminRoutes from './modules/admin/admin.routes.js'
import postsRoutes, { mobilePostsRouter } from './modules/posts/posts.routes.js'
import commentsRoutes from './modules/comments/comments.routes.js'
import reactionsRoutes, { mobileReactionsRouter } from './modules/reactions/reactions.routes.js'
import notificationsRoutes from './modules/notifications/notifications.routes.js'
import stocksRoutes from './modules/stocks/stocks.routes.js'
import stockRecommendationsRoutes from './modules/stock-recommendations/stock-recommendations.routes.js'
import paymentsRoutes from './modules/payments/payments.routes.js'
import type { PlanListItemDTO } from './modules/payments/payments.dto.js'
import prisma from './lib/prisma.js'
import { authenticate, requireMobileAuth } from './middlewares/auth.middleware.js'

function buildCorsOptions(): CorsOptions {
  const { origin, credentials } = env.cors

  if (origin === '*' && credentials) {
    return {
      origin: (requestOrigin, callback) => callback(null, requestOrigin ?? false),
      credentials: true,
    }
  }

  return { origin, credentials }
}

export function createApp() {
  const app = express()

  app.use(cors(buildCorsOptions()))
  app.use(express.json())
  app.use(cookieParser())

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() })
  })

  // Currently documents the mobile-auth module only — see src/config/swagger.ts
  app.use(swaggerDocsPath, swaggerUi.serve, swaggerUi.setup(swaggerSpec))
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec))

  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/auth/mobile', mobileAuthRoutes)
  app.use('/api/v1/admin', adminRoutes)
  app.use('/api/v1/posts', postsRoutes)
  app.use('/api/v1', commentsRoutes)
  app.use('/api/v1', reactionsRoutes)
  app.use('/api/v1/notifications', notificationsRoutes)
  app.use('/api/v1/stocks', stocksRoutes)
  app.use('/api/v1/stock-recommendations', stockRecommendationsRoutes)
  app.use('/api/v1', paymentsRoutes)
  // Mobile app's own copies of the feed/reactions endpoints above, gated to
  // MobileSession auth only (requireMobileAuth) — see posts.routes.ts and
  // reactions.routes.ts for why these are separate from the shared routes.
  app.use('/api/v1/mobile', mobilePostsRouter)
  app.use('/api/v1/mobile', mobileReactionsRouter)

  // Community discovery/paywall listing — mobile-only (requireMobileAuth):
  // no web consumer exists, and it's built for the mobile app's subscription
  // screen (cover image, badge, "what's included", plans all bundled per
  // community in one call).
  /**
   * @openapi
   * /mobile/communities:
   *   get:
   *     tags: [Communities]
   *     summary: List purchasable communities (mobile paywall/discovery screen)
   *     description: >
   *       Every non-deleted community except the one free community (there is
   *       always exactly one `isFree: true` community, auto-joined at
   *       registration — see mobile-auth.service.ts#finalizeRegistration — and
   *       it never has purchasable plans, so it's excluded here). Mobile-only:
   *       a web JWT is rejected with 403 MOBILE_ONLY, same as
   *       GET /mobile/posts.
   *     responses:
   *       200:
   *         description: All purchasable communities, alphabetical by name.
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
   *                       name: { type: string }
   *                       slug: { type: string }
   *                       description: { type: string, nullable: true }
   *                       tags: { type: array, items: { type: string } }
   *                       type:
   *                         type: string
   *                         nullable: true
   *                         description: Freeform category label, e.g. "Short Term Investment".
   *                       coverImageUrl: { type: string, nullable: true, description: "Banner image." }
   *                       badgeUrl: { type: string, nullable: true, description: "Small icon shown on the card." }
   *                       whatsIncluded:
   *                         type: array
   *                         items: { type: string }
   *                         description: Shared "What You Get" bullet list, same across all of this community's plans.
   *                       subscribedMemberCount:
   *                         type: integer
   *                         description: Distinct users with an active, non-expired subscription right now.
   *                       plans:
   *                         type: array
   *                         description: Active plans, ordered by durationMonths ascending.
   *                         items:
   *                           type: object
   *                           properties:
   *                             id: { type: string, format: uuid }
   *                             name: { type: string }
   *                             durationMonths: { type: integer }
   *                             price: { type: number }
   *       401:
   *         description: Not authenticated.
   *         content:
   *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
   *       403:
   *         description: Authenticated via web JWT instead of a mobile session (code MOBILE_ONLY).
   *         content:
   *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
   */
  app.get('/api/v1/mobile/communities', authenticate, requireMobileAuth, async (_req, res, next) => {
    try {
      const communities = await prisma.community.findMany({
        where: { deletedAt: null, isFree: false },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          tags: true,
          type: true,
          coverImageUrl: true,
          badgeUrl: true,
          whatsIncluded: true,
        },
        orderBy: { name: 'asc' },
      })

      // Distinct subscribed-member count per community — grouped on
      // (communityId, userId) rather than a plain groupBy(['communityId'])
      // count, so a user with more than one active subscription row for the
      // same community (e.g. an un-deactivated renewal) is only counted
      // once. Same "active + not expired" definition used to gate access
      // elsewhere (posts.service.ts#assertMemberSubscribed, reactions.service.ts).
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const activeSubscribers = await prisma.subscription.groupBy({
        by: ['communityId', 'userId'],
        where: {
          communityId: { in: communities.map(c => c.id) },
          isActive: true,
          validUntil: { gte: today },
        },
      })
      const memberCountByCommunity = new Map<string, number>()
      for (const s of activeSubscribers) {
        memberCountByCommunity.set(s.communityId, (memberCountByCommunity.get(s.communityId) ?? 0) + 1)
      }

      // Active plans for every community in one batched query — same
      // isActive filter / durationMonths ordering as
      // PaymentsService#listPlans, just not per-community.
      const plans = await prisma.plan.findMany({
        where: { communityId: { in: communities.map(c => c.id) }, isActive: true },
        orderBy: { durationMonths: 'asc' },
        select: { id: true, communityId: true, name: true, durationMonths: true, price: true },
      })
      const plansByCommunity = new Map<string, PlanListItemDTO[]>()
      for (const p of plans) {
        const list = plansByCommunity.get(p.communityId) ?? []
        list.push({ id: p.id, name: p.name, durationMonths: p.durationMonths, price: Number(p.price) })
        plansByCommunity.set(p.communityId, list)
      }

      res.json({
        success: true,
        data: communities.map(c => ({
          ...c,
          subscribedMemberCount: memberCountByCommunity.get(c.id) ?? 0,
          plans: plansByCommunity.get(c.id) ?? [],
        })),
      })
    } catch (err) {
      next(err)
    }
  })

  app.use((_req, _res, next) => next(new NotFoundError('Route not found')))
  app.use(errorMiddleware)

  return app
}
