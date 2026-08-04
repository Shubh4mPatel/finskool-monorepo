import type { PrismaClient } from '../generated/prisma/client.js'
import { formatEmailDate } from './email-templates.js'
import { notifyOnce } from './notify-once.js'
import { logger } from '../shared/logger.js'
import { NotificationType } from '../modules/notifications/notifications.dto.js'
import type { NotificationsService } from '../modules/notifications/notifications.service.js'

type Bucket = 'expiring-7' | 'expiring-1' | 'expired'

// Windows (not exact-day matches) so a subscription is still caught the next
// day the sweep runs, even if a previous day's run was skipped (e.g. during a
// deploy) — see notifyOnce for the other half of what makes this safe to
// re-run daily without double-notifying.
function bucketFor(daysUntilExpiry: number): Bucket | null {
  if (daysUntilExpiry >= 2 && daysUntilExpiry <= 7) return 'expiring-7'
  if (daysUntilExpiry >= 0 && daysUntilExpiry <= 1) return 'expiring-1'
  if (daysUntilExpiry >= -7 && daysUntilExpiry <= -1) return 'expired'
  return null
}

export async function runSubscriptionLifecycleSweep(
  db: PrismaClient,
  notifications: NotificationsService,
): Promise<{ processed: number; notified: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const windowStart = new Date(today)
  windowStart.setDate(today.getDate() - 7)
  const windowEnd = new Date(today)
  windowEnd.setDate(today.getDate() + 7)

  const subs = await db.subscription.findMany({
    where: {
      isActive: true,
      validUntil: { gte: windowStart, lte: windowEnd },
      user: { isActive: true },
    },
    select: {
      id: true,
      communityId: true,
      validUntil: true,
      user: { select: { id: true, name: true, phone: true, email: true } },
      community: { select: { name: true, paymentLink: true } },
    },
  })

  let notified = 0
  for (const sub of subs) {
    const daysUntilExpiry = Math.ceil((sub.validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    const bucket = bucketFor(daysUntilExpiry)
    if (!bucket) continue

    const validTillFormatted = formatEmailDate(sub.validUntil)
    const type =
      bucket === 'expiring-7' ? NotificationType.SubscriptionExpiring7Days :
      bucket === 'expiring-1' ? NotificationType.SubscriptionExpiring1Day :
      NotificationType.SubscriptionExpired

    const title =
      bucket === 'expiring-7' ? 'Access ends in 7 days' :
      bucket === 'expiring-1' ? 'Last day of access' :
      'Access paused'

    const message =
      bucket === 'expiring-7' ? `Your ${sub.community.name} subscription expires on ${validTillFormatted}. Email support@finskool21.com to extend.` :
      bucket === 'expiring-1' ? `Your ${sub.community.name} subscription ends tomorrow. Email support@finskool21.com to extend.` :
      `Email support@finskool21.com to restore your ${sub.community.name} access.`

    // sourceId = the Subscription's own id — stable per subscription, so the
    // (userId, type, sourceId) unique constraint means "has this exact
    // subscription already been notified for this exact lifecycle event?"
    const createdId = await notifyOnce({
      db, communityId: sub.communityId, userId: sub.user.id,
      type, sourceId: sub.id, title, message,
    })
    if (createdId === null) continue // already notified for this subscription+type — skip the email too

    notified++
    const emailPayload = {
      toEmail: sub.user.email,
      name: sub.user.name,
      phone: sub.user.phone,
      communityName: sub.community.name,
      validTill: sub.validUntil.toISOString(),
      paymentLink: sub.community.paymentLink,
    }
    try {
      if (bucket === 'expiring-7') await notifications.sendSubscriptionExpiring7DaysEmail(emailPayload)
      else if (bucket === 'expiring-1') await notifications.sendSubscriptionExpiring1DayEmail(emailPayload)
      else await notifications.sendSubscriptionExpiredEmail(emailPayload)
    } catch (err) {
      // In-app row already succeeded — an SMTP hiccup shouldn't roll that back
      // or fail the whole sweep (same reasoning as sendEmailBatch elsewhere).
      logger.error({ err, subscriptionId: sub.id, type }, 'subscriptionLifecycleSweep: email send failed')
    }
  }

  logger.info({ processed: subs.length, notified }, 'subscriptionLifecycleSweep: done')
  return { processed: subs.length, notified }
}

// Flips isActive false for subscriptions that lapsed more than 7 days ago.
// Deliberately stays clear of the reminder sweep's own [-7,-1] day "expired"
// window (bucketFor above) — that job's query filters on isActive: true, so
// this one must never flip a row inactive while the reminder sweep still has
// a chance to send its one-time "access paused" notification for it. Once a
// subscription falls outside that window it's no longer of interest to the
// reminder sweep either way, so it's safe to retire here.
export async function expireLapsedSubscriptions(db: PrismaClient): Promise<{ expired: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cutoff = new Date(today)
  cutoff.setDate(today.getDate() - 7)

  const result = await db.subscription.updateMany({
    where: { isActive: true, validUntil: { lt: cutoff } },
    data: { isActive: false },
  })

  logger.info({ expired: result.count }, 'expireLapsedSubscriptions: done')
  return { expired: result.count }
}
