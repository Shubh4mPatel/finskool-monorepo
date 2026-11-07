import type { PrismaClient } from '../generated/prisma/client.js'
import redis from './redis.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveNotificationEvent } from './queue.js'
import { logger } from '../shared/logger.js'

export interface AdminNotification {
  db: PrismaClient
  /** Who to tell. Callers pick the audience (all admins for services, the community's admins for tickets). */
  adminIds: string[]
  type: string
  /** Identifies this one event (ticket id, message id, payment id...). A repeat of the same event adds nothing. */
  sourceId: string
  communityId: string | null
  title: string
  message: string
  /** Routing for the admin web inbox, built with routingData(). */
  data: Record<string, string>
}

/**
 * Tells admins about something a member did: one inbox row each plus a live event for the open admin web.
 * Admins get no push (they use the web), so there is no push queue involved. Never throws; this is a side
 * effect of the member's action and must not fail it.
 *
 * Returns the admins who were told just now: not the ones who already had this exact event. A caller that
 * adds another channel (an email) sends it to these only, so a repeated event doesn't mail anyone twice.
 */
export async function notifyAdmins(n: AdminNotification): Promise<string[]> {
  if (n.adminIds.length === 0) return []
  try {
    // skipDuplicates + returning the created rows: an admin who already has this exact event gets nothing again.
    const created = await n.db.notification.createManyAndReturn({
      data: n.adminIds.map(userId => ({
        userId,
        communityId: n.communityId,
        type: n.type,
        sourceId: n.sourceId,
        title: n.title,
        message: n.message,
        data: n.data,
      })),
      skipDuplicates: true,
      select: { userId: true },
    })
    // The rows are saved, so a failed live event is only logged: it must not hide that these admins were told.
    const published = await Promise.allSettled(
      created.map(row =>
        redis.publish(
          NOTIFICATIONS_PUBSUB_CHANNEL,
          JSON.stringify({ userId: row.userId, type: n.type, communityId: n.communityId, message: n.message, sourceId: n.sourceId } satisfies LiveNotificationEvent),
        ),
      ),
    )
    for (const result of published) {
      if (result.status === 'rejected') logger.error({ err: result.reason, type: n.type, sourceId: n.sourceId }, 'notifyAdmins: live event failed')
    }
    return created.map(row => row.userId)
  } catch (err) {
    logger.error({ err, type: n.type, sourceId: n.sourceId }, 'notifyAdmins failed')
    return []
  }
}
