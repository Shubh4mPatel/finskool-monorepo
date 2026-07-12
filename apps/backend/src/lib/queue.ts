import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { env } from '../config/env.js'

export const NOTIFICATIONS_QUEUE_NAME = 'notifications'
export const COMMUNITY_POST_JOB = 'community-post'

export interface CommunityPostNotificationJobPayload {
  communityId: string
  postId: string
  message: string
  triggeredByUserId: string
}

// BullMQ requires maxRetriesPerRequest: null on any Redis connection it manages —
// a different tuning than lib/redis.ts's client (used for refresh tokens/caching).
// Passed as plain options (not a shared ioredis.Redis instance) so BullMQ builds
// its own connection using its bundled ioredis types, and so the API process
// (this file) and the worker process each get an independent connection.
export function createBullConnection(): ConnectionOptions {
  return {
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password || undefined,
    db: env.redis.db,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
}

export const notificationsQueue = new Queue<CommunityPostNotificationJobPayload, unknown, string>(
  NOTIFICATIONS_QUEUE_NAME,
  { connection: createBullConnection() },
)
