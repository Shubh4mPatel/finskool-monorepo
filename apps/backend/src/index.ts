import 'dotenv/config'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './shared/logger.js'
import prisma from './lib/prisma.js'
import redis from './lib/redis.js'
import { ensureStocksSeeded } from './lib/stock-import.js'

async function bootstrap() {
  await redis.connect()

  const app = createApp()

  const server = app.listen(env.port, () => {
    logger.info(`finskool-backend running on port ${env.port} [${env.nodeEnv}]`)
  })

  // Fire-and-forget: only does work (fetch + bulk insert) the first time the
  // stocks table is empty. Runs in the background so a slow fetch never
  // delays the server coming up / the health check responding.
  void ensureStocksSeeded(prisma).catch(err => {
    logger.error({ err }, 'stock-import: automatic import failed')
  })

  async function shutdown(signal: string) {
    logger.info(`${signal} received — shutting down`)
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
