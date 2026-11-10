import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { createAndPublishNotification } from './notify-once.js'
import { notificationsQueue, SUBSCRIPTION_REDUCED_EMAIL_JOB } from './queue.js'
import { subscriptionRouting } from './notification-routing.js'
import { formatEmailDate } from './email-templates.js'
import { NotificationType } from '../modules/notifications/notifications.dto.js'
import { logger } from '../shared/logger.js'

/**
 * Whether a change of end date shortens a plan that is still running. A plan that had already ended, or a new end
 * date that is the same or later, is not a reduction (the first is a renewal, the second an extension).
 */
export function isReduction(previousEnd: Date | null, newEnd: Date, today: Date): previousEnd is Date {
  return previousEnd !== null && previousEnd >= today && newEnd < previousEnd
}

/**
 * Tells a member an admin moved the end date of their plan in one community earlier: an inbox row, the live socket
 * and a push (all skipped if they are suspended from that community), plus an email. Never throws; it is a side
 * effect of the admin's change and must not fail it.
 */
export async function notifySubscriptionReduced(
  db: PrismaClient,
  p: {
    userId: string
    name: string
    email: string | null
    communityId: string
    communityName: string
    previousValidUntil: Date
    newValidUntil: Date
  },
): Promise<void> {
  const message = `Your ${p.communityName} plan has been reduced. It now ends on ${formatEmailDate(p.newValidUntil)}.`
  const data = subscriptionRouting(p.communityId, 'reduced')
  let delivered = true
  try {
    // A fresh source id each time: every change an admin makes is its own event, never a repeat of an earlier one.
    const id = await createAndPublishNotification({
      db,
      communityId: p.communityId,
      userId: p.userId,
      type: NotificationType.SubscriptionReduced,
      sourceId: randomUUID(),
      title: 'Plan duration reduced',
      message,
      data,
      push: { data },
    })
    delivered = id !== null
  } catch (err) {
    logger.error({ err, userId: p.userId, communityId: p.communityId }, 'notifySubscriptionReduced: inbox notification failed')
  }

  if (!delivered || !p.email) return
  try {
    await notificationsQueue.add(
      SUBSCRIPTION_REDUCED_EMAIL_JOB,
      {
        toEmail: p.email,
        name: p.name,
        communityName: p.communityName,
        validTill: p.newValidUntil.toISOString(),
        previousValidTill: p.previousValidUntil.toISOString(),
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
    )
  } catch (err) {
    logger.error({ err, userId: p.userId, communityId: p.communityId }, 'notifySubscriptionReduced: failed to enqueue the email job')
  }
}
