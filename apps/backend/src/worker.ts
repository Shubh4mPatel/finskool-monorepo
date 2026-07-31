import 'dotenv/config'
import { Worker } from 'bullmq'
import {
  createBullConnection,
  NOTIFICATIONS_QUEUE_NAME,
  COMMUNITY_POST_JOB,
  COMMUNITY_RECOMMENDATION_JOB,
  THREAD_REPLY_EMAIL_JOB,
  WELCOME_EMAIL_JOB,
  SUBSCRIPTION_EXTENDED_EMAIL_JOB,
  COMMUNITY_ADDED_EMAIL_JOB,
  COMMUNITY_ACCESS_REMOVED_EMAIL_JOB,
  NEW_MEMBER_REGISTERED_EMAIL_JOB,
} from './lib/queue.js'
import prisma from './lib/prisma.js'
import { logger } from './shared/logger.js'
import { NotificationsService } from './modules/notifications/notifications.service.js'

const service = new NotificationsService(prisma)
const connection = createBullConnection()

const worker = new Worker(
  NOTIFICATIONS_QUEUE_NAME,
  async job => {
    if (job.name === COMMUNITY_POST_JOB) return service.fanOutCommunityPost(job.data)
    if (job.name === COMMUNITY_RECOMMENDATION_JOB) return service.fanOutCommunityRecommendation(job.data)
    if (job.name === THREAD_REPLY_EMAIL_JOB) return service.sendThreadReplyEmail(job.data)
    if (job.name === WELCOME_EMAIL_JOB) return service.sendWelcomeEmail(job.data)
    if (job.name === SUBSCRIPTION_EXTENDED_EMAIL_JOB) return service.sendSubscriptionExtendedEmail(job.data)
    if (job.name === COMMUNITY_ADDED_EMAIL_JOB) return service.sendCommunityAddedEmail(job.data)
    if (job.name === COMMUNITY_ACCESS_REMOVED_EMAIL_JOB) return service.sendCommunityAccessRemovedEmail(job.data)
    if (job.name === NEW_MEMBER_REGISTERED_EMAIL_JOB) return service.sendNewMemberRegisteredEmail(job.data)
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
