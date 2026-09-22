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
import postsRoutes from './modules/posts/posts.routes.js'
import commentsRoutes from './modules/comments/comments.routes.js'
import reactionsRoutes from './modules/reactions/reactions.routes.js'
import notificationsRoutes from './modules/notifications/notifications.routes.js'
import stocksRoutes from './modules/stocks/stocks.routes.js'
import stockRecommendationsRoutes from './modules/stock-recommendations/stock-recommendations.routes.js'
import paymentsRoutes from './modules/payments/payments.routes.js'
import prisma from './lib/prisma.js'
import { authenticate } from './middlewares/auth.middleware.js'

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

  app.get('/api/v1/communities', authenticate, async (_req, res, next) => {
    try {
      const communities = await prisma.community.findMany({
        where: { deletedAt: null, isFree: false },
        select: { id: true, name: true, slug: true, description: true, tags: true, type: true, coverImageUrl: true },
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

      res.json({
        success: true,
        data: communities.map(c => ({
          ...c,
          subscribedMemberCount: memberCountByCommunity.get(c.id) ?? 0,
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
