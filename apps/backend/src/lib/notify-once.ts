import type { PrismaClient } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import redis from './redis.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveNotificationEvent } from './queue.js'
import { logger } from '../shared/logger.js'

export interface NotificationRowParams {
  db: PrismaClient
  communityId: string
  userId: string
  type: string
  sourceId: string
  title: string
  message: string
}

// Shared by notifyOnce (below) and by digest jobs whose sourceId is always a
// fresh randomUUID() (so a unique-constraint violation there would be a real
// bug, not an expected race) — keeps the create + live-pubsub-publish
// behavior in one place, mirroring admin.service.ts's notifyImportComplete /
// NotificationsService's publishLiveBatch.
export async function createAndPublishNotification(params: NotificationRowParams): Promise<string> {
  const { db, communityId, userId, type, sourceId, title, message } = params
  const row = await db.notification.create({
    data: { communityId, userId, type, sourceId, title, message },
    select: { id: true },
  })
  try {
    await redis.publish(
      NOTIFICATIONS_PUBSUB_CHANNEL,
      JSON.stringify({ userId, type, communityId, message, sourceId } satisfies LiveNotificationEvent),
    )
  } catch (err) {
    logger.error({ err, userId, type, sourceId }, 'createAndPublishNotification: live publish failed')
  }
  return row.id
}

/**
 * Attempts to create a Notification row keyed by the
 * uq_notifications_user_type_source unique constraint (userId, type,
 * sourceId). Returns the new row's id on first-time success, or null if a
 * row for this exact (userId, type, sourceId) already exists — a Prisma
 * P2002 unique-violation, caught here as an EXPECTED "already notified,
 * skip" signal rather than an error. Callers must only send the paired
 * email when this returns non-null, so email delivery and the in-app row
 * stay in lockstep (no email fires without a first-time notification row,
 * and vice versa).
 */
export async function notifyOnce(params: NotificationRowParams): Promise<string | null> {
  try {
    return await createAndPublishNotification(params)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null
    }
    throw err
  }
}
