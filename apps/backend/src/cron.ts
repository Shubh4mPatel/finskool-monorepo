import 'dotenv/config'
import { Worker } from 'bullmq'
import {
  createBullConnection,
  STOCK_CLOSE_PRICE_QUEUE_NAME,
  REFRESH_CLOSE_PRICES_JOB,
  stockClosePriceQueue,
  DIGEST_QUEUE_NAME,
  SUBSCRIPTION_LIFECYCLE_SWEEP_JOB,
  ADMIN_UNREPLIED_DIGEST_JOB,
  ADMIN_EXPIRY_DIGEST_JOB,
  EXPIRE_SUBSCRIPTIONS_JOB,
  digestQueue,
} from './lib/queue.js'
import prisma from './lib/prisma.js'
import { logger } from './shared/logger.js'
import { NotificationsService } from './modules/notifications/notifications.service.js'
import { refreshAllStockClosePrices } from './lib/stock-quote-api.js'
import { runSubscriptionLifecycleSweep, expireLapsedSubscriptions } from './lib/subscription-lifecycle.js'
import { runAdminUnrepliedDigest, runAdminExpiryDigest } from './lib/admin-digests.js'

const notificationsService = new NotificationsService(prisma)
const connection = createBullConnection()

// Same queue/job as before, moved from worker.ts unchanged — cron.ts now both
// schedules (see registerSchedulers below) AND executes this job, i.e. it's
// fully self-contained and independent of index.ts/worker.ts.
const stockPriceWorker = new Worker(
  STOCK_CLOSE_PRICE_QUEUE_NAME,
  async job => {
    if (job.name === REFRESH_CLOSE_PRICES_JOB) return refreshAllStockClosePrices(prisma)
  },
  { connection, concurrency: 1 },
)
stockPriceWorker.on('completed', job => logger.info({ jobId: job.id, result: job.returnvalue }, 'stock close-price job completed'))
stockPriceWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'stock close-price job failed'))

const digestWorker = new Worker(
  DIGEST_QUEUE_NAME,
  async job => {
    if (job.name === SUBSCRIPTION_LIFECYCLE_SWEEP_JOB) return runSubscriptionLifecycleSweep(prisma, notificationsService)
    if (job.name === ADMIN_UNREPLIED_DIGEST_JOB) return runAdminUnrepliedDigest(prisma, notificationsService)
    if (job.name === ADMIN_EXPIRY_DIGEST_JOB) return runAdminExpiryDigest(prisma, notificationsService)
    if (job.name === EXPIRE_SUBSCRIPTIONS_JOB) return expireLapsedSubscriptions(prisma)
  },
  { connection, concurrency: 1 },
)
digestWorker.on('completed', job => logger.info({ jobId: job.id, name: job.name, result: job.returnvalue }, 'digest job completed'))
digestWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, name: job?.name, err }, 'digest job failed'))

async function shutdown(signal: string) {
  logger.info(`${signal} received — shutting down cron`)
  await stockPriceWorker.close()
  await digestWorker.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

logger.info('stock close-price worker started')
logger.info('digest worker started')

// Idempotent — safe to call on every boot, updates existing schedules in
// place rather than creating duplicates. Moved here from index.ts's
// bootstrap() so scheduled work no longer depends on the API process.
async function registerSchedulers() {
  await stockClosePriceQueue.upsertJobScheduler(
    'daily-close-price',
    { pattern: '30 15 * * 1-5', tz: 'Asia/Kolkata' }, // Mon-Fri, 3:30 PM IST
    { name: REFRESH_CLOSE_PRICES_JOB },
  )
  await digestQueue.upsertJobScheduler(
    'daily-subscription-lifecycle-sweep',
    { pattern: '0 9 * * *', tz: 'Asia/Kolkata' }, // every day, 9:00 AM IST
    { name: SUBSCRIPTION_LIFECYCLE_SWEEP_JOB },
  )
  await digestQueue.upsertJobScheduler(
    'daily-admin-unreplied-digest',
    { pattern: '30 9 * * *', tz: 'Asia/Kolkata' }, // every day, 9:30 AM IST
    { name: ADMIN_UNREPLIED_DIGEST_JOB },
  )
  await digestQueue.upsertJobScheduler(
    'weekly-admin-expiry-digest',
    { pattern: '0 10 * * 1', tz: 'Asia/Kolkata' }, // Mondays, 10:00 AM IST
    { name: ADMIN_EXPIRY_DIGEST_JOB },
  )
  await digestQueue.upsertJobScheduler(
    'daily-expire-subscriptions',
    { pattern: '0 2 * * *', tz: 'Asia/Kolkata' }, // every day, 2:00 AM IST
    { name: EXPIRE_SUBSCRIPTIONS_JOB },
  )
}

registerSchedulers()
  .then(() => logger.info('cron: schedulers registered'))
  .catch(err => {
    logger.error({ err }, 'cron: failed to register schedulers')
    process.exit(1)
  })
