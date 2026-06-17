import 'dotenv/config'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './shared/logger.js'
import prisma from './lib/prisma.js'
import redis from './lib/redis.js'

async function bootstrap() {
  await redis.connect()

  const app = createApp()

  const server = app.listen(env.port, () => {
    logger.info(`finskool-backend running on port ${env.port} [${env.nodeEnv}]`)
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
