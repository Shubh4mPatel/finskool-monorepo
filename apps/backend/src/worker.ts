import 'dotenv/config'
import { Worker } from 'bullmq'
import { createBullConnection, NOTIFICATIONS_QUEUE_NAME, COMMUNITY_POST_JOB } from './lib/queue.js'
import prisma from './lib/prisma.js'
import { logger } from './shared/logger.js'
import { NotificationsService } from './modules/notifications/notifications.service.js'

const service = new NotificationsService(prisma)
const connection = createBullConnection()

const worker = new Worker(
  NOTIFICATIONS_QUEUE_NAME,
  async job => {
    if (job.name === COMMUNITY_POST_JOB) return service.fanOutCommunityPost(job.data)
  },
  { connection, concurrency: 5 },
)

worker.on('completed', job => logger.info({ jobId: job.id }, 'notification job completed'))
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'notification job failed'))

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down worker`)
  await worker.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

logger.info('notifications worker started')
