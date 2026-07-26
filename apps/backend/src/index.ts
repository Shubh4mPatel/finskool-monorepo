import 'dotenv/config'
import http from 'node:http'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './shared/logger.js'
import prisma from './lib/prisma.js'
import redis from './lib/redis.js'
import { ensureStocksSeeded } from './lib/stock-import.js'
import { AngelOneClient } from './sockets/angelone/angelone.client.js'
import { liveStockFeed } from './lib/live-stock-feed.js'
import { liveNotificationsFeed } from './lib/live-notifications-feed.js'
import { stockClosePriceQueue, REFRESH_CLOSE_PRICES_JOB } from './lib/queue.js'

async function bootstrap() {
  await redis.connect()

  const app = createApp()
  // Plain http.createServer (not app.listen) so the live-stock-price
  // WebSocket can attach via the server's 'upgrade' event.
  const server = http.createServer(app)

  server.listen(env.port, () => {
    logger.info(`finskool-backend running on port ${env.port} [${env.nodeEnv}]`)
  })

  // Fire-and-forget: only does work (fetch + bulk insert) the first time the
  // stocks table is empty. Runs in the background so a slow fetch never
  // delays the server coming up / the health check responding.
  void ensureStocksSeeded(prisma).catch(err => {
    logger.error({ err }, 'stock-import: automatic import failed')
  })

  // Idempotent — safe to call on every boot, updates the existing schedule
  // in place rather than creating a duplicate. Mon–Fri, 3:30 PM IST.
  await stockClosePriceQueue.upsertJobScheduler(
    'daily-close-price',
    { pattern: '30 15 * * 1-5', tz: 'Asia/Kolkata' },
    { name: REFRESH_CLOSE_PRICES_JOB },
  )

  const angelOne = new AngelOneClient()
  liveStockFeed.attach(server, angelOne, prisma)
  angelOne.connect()

  liveNotificationsFeed.attach(server)

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down`)
    angelOne.destroy()
    server.close(async () => {
      await prisma.$disconnect()
      await redis.quit()
      logger.info('shutdown complete')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

bootstrap().catch((err) => {
  console.error('Failed to start server', err)
  process.exit(1)
})
