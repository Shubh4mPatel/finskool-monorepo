import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { env } from '../config/env.js'

export const NOTIFICATIONS_QUEUE_NAME = 'notifications'
export const COMMUNITY_POST_JOB = 'community-post'
export const COMMUNITY_RECOMMENDATION_JOB = 'community-recommendation'
export const THREAD_REPLY_EMAIL_JOB = 'thread-reply-email'

// Separate from the notifications queue: this is a ~20-minute sweep over every
// active stock (rate-limited to Finedge's 300 req/min), so it shouldn't
// compete with time-sensitive notification jobs for worker concurrency slots.
export const STOCK_CLOSE_PRICE_QUEUE_NAME = 'stock-close-price'
export const REFRESH_CLOSE_PRICES_JOB = 'refresh-close-prices'

export interface CommunityPostNotificationJobPayload {
  communityId: string
  postId: string
  message: string
  triggeredByUserId: string
  postTitle: string
  postExcerpt: string
}

export interface CommunityRecommendationNotificationJobPayload {
  communityId: string
  recommendationId: string
  message: string
  triggeredByUserId: string
  stockSymbol: string
}

export interface ThreadReplyEmailJobPayload {
  toEmail: string
  recipientName: string
  adminName: string
  postTitle: string
  replyExcerpt: string
}

export const WELCOME_EMAIL_JOB = 'welcome-email'

export interface WelcomeEmailJobPayload {
  toEmail: string
  name: string
  phone: string
  communityName: string
  validTill: string
}

export const SUBSCRIPTION_EXTENDED_EMAIL_JOB = 'subscription-extended-email'

export interface SubscriptionExtendedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  validTill: string
  amount: number
  paidOn: string
}

export const COMMUNITY_ADDED_EMAIL_JOB = 'community-added-email'

export interface CommunityAddedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  validTill: string
}

export const COMMUNITY_ACCESS_REMOVED_EMAIL_JOB = 'community-access-removed-email'

export interface CommunityAccessRemovedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
}

export const NEW_MEMBER_REGISTERED_EMAIL_JOB = 'new-member-registered-email'

export interface NewMemberRegisteredEmailJobPayload {
  adminEmail: string
  adminName: string
  memberName: string
  phone: string
  communityName: string
  registeredDate: string
}

export type NotificationJobPayload =
  | CommunityPostNotificationJobPayload
  | CommunityRecommendationNotificationJobPayload
  | ThreadReplyEmailJobPayload
  | WelcomeEmailJobPayload
  | SubscriptionExtendedEmailJobPayload
  | CommunityAddedEmailJobPayload
  | CommunityAccessRemovedEmailJobPayload
  | NewMemberRegisteredEmailJobPayload

// Published by NotificationsService (running in the worker process) whenever a
// new notification row is created, and consumed by lib/live-notifications-feed.ts
// (running in the API process) to push it to the recipient's open tabs over
// WebSocket immediately instead of waiting for the client's next poll.
export const NOTIFICATIONS_PUBSUB_CHANNEL = 'notifications:live'

export interface LiveNotificationEvent {
  userId: string
  type: string
  communityId: string
  message: string
  sourceId: string
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

export const notificationsQueue = new Queue<NotificationJobPayload, unknown, string>(
  NOTIFICATIONS_QUEUE_NAME,
  { connection: createBullConnection() },
)

export const stockClosePriceQueue = new Queue(
  STOCK_CLOSE_PRICE_QUEUE_NAME,
  { connection: createBullConnection() },
)
