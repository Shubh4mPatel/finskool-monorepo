import express from 'express'
import type { CorsOptions } from 'cors'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { env } from './config/env.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import { NotFoundError } from './shared/errors/index.js'
import authRoutes from './modules/auth/auth.routes.js'
import adminRoutes from './modules/admin/admin.routes.js'
import postsRoutes from './modules/posts/posts.routes.js'
import commentsRoutes from './modules/comments/comments.routes.js'
import notificationsRoutes from './modules/notifications/notifications.routes.js'
import stocksRoutes from './modules/stocks/stocks.routes.js'
import stockRecommendationsRoutes from './modules/stock-recommendations/stock-recommendations.routes.js'
import prisma from './lib/prisma.js'

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

  app.use('/api/v1/auth', authRoutes)
  app.use('/api/v1/admin', adminRoutes)
  app.use('/api/v1/posts', postsRoutes)
  app.use('/api/v1', commentsRoutes)
  app.use('/api/v1/notifications', notificationsRoutes)
  app.use('/api/v1/stocks', stocksRoutes)
  app.use('/api/v1/stock-recommendations', stockRecommendationsRoutes)

  app.get('/api/v1/communities', async (_req, res, next) => {
    try {
      const communities = await prisma.community.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true, description: true, coverImageUrl: true },
        orderBy: { name: 'asc' },
      })
      res.json({ success: true, data: communities })
    } catch (err) {
      next(err)
    }
  })

  app.use((_req, _res, next) => next(new NotFoundError('Route not found')))
  app.use(errorMiddleware)

  return app
}
