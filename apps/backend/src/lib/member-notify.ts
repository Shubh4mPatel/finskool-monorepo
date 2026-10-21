import type { PrismaClient } from '../generated/prisma/client.js'
import { Prisma } from '../generated/prisma/client.js'
import redis from './redis.js'
import { NOTIFICATIONS_PUBSUB_CHANNEL } from './queue.js'
import type { LiveNotificationEvent } from './queue.js'
import { enqueuePush } from './push.js'
import { NotificationType } from '../modules/notifications/notifications.dto.js'
import { logger } from '../shared/logger.js'

export interface ThreadNotification {
  db: PrismaClient
  userId: string
  kind: 'ticket' | 'service'
  /** The ticket / service request id, sent to the app so it can open the right chat. */
  threadId: string
  /**
   * Identifies this one event (a message id, quote id, payment id...). It becomes the inbox row's
   * sourceId, so every event gets its own row and a retry of the same event never doubles it.
   * Must be unique per member and kind across events.
   */
  eventId: string
  /** Ticket community; null for service requests, which belong to no community. */
  communityId: string | null
  title: string
  message: string
  /** What happened, e.g. 'reply', 'resolved', 'quote'. Sent to the app so it can route the tap. */
  event: string
}

/**
 * Tells a member about activity on one of their tickets or service requests: adds one inbox row for the
 * event (so the inbox keeps the full history), pushes it to the open app over the live socket, and
 * queues a push notification. Never throws; this is a side effect of the real action and must not fail it.
 *
 * Rows are unique per (member, type, eventId). If the same event is reported twice, the second call
 * finds the row already there and does nothing, so the member is neither shown nor pushed it twice.
 */
export async function notifyMemberThread(n: ThreadNotification): Promise<void> {
  const type = n.kind === 'ticket' ? NotificationType.TicketUpdate : NotificationType.ServiceUpdate
  const data = { type: n.kind, id: n.threadId, event: n.event, ...(n.communityId ? { communityId: n.communityId } : {}) }
  try {
    await n.db.notification.create({
      data: { userId: n.userId, communityId: n.communityId, type, sourceId: n.eventId, title: n.title, message: n.message, data },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return
    logger.error({ err, userId: n.userId, kind: n.kind, threadId: n.threadId }, 'notifyMemberThread: inbox row failed')
    return
  }
  try {
    await redis.publish(
      NOTIFICATIONS_PUBSUB_CHANNEL,
      JSON.stringify({ userId: n.userId, type, communityId: n.communityId, message: n.message, sourceId: n.eventId } satisfies LiveNotificationEvent),
    )
  } catch (err) {
    logger.error({ err, userId: n.userId }, 'notifyMemberThread: live publish failed')
  }
  await enqueuePush({ userIds: [n.userId], title: n.title, body: n.message, data, collapseKey: `${n.kind}:${n.threadId}` })
}

/** Short lock-screen text for a chat message: the start of its text, or a placeholder for attachment-only messages. */
export function messagePreview(body: string | null | undefined, attachmentCount: number): string {
  const text = (body ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return attachmentCount > 0 ? 'Sent you an attachment' : 'New message'
  return text.length > 100 ? `${text.slice(0, 99)}…` : text
}
