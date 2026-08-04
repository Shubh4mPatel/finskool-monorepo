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

// Flips isActive false for subscriptions the day immediately after their last
// valid day — no grace period. This is safe against the reminder sweep's own
// [0,1] day "expiring-1" bucket without any ordering/scheduling coordination
// between the two jobs: that bucket only ever fires the day before or on the
// day of expiry (validUntil >= today), while this job only ever acts starting
// the day after (validUntil < today) — the two windows never overlap.
//
// Also flips the member's persisted ApprovedPhone.status to 'expired' (only
// out of 'registered' — a member who's already suspended/deleted keeps that
// status) and sends the "your access has ended" notification. That email uses
// the exact same notifyOnce dedup key — (userId, SubscriptionExpired,
// subscriptionId) — as the reminder sweep's own (still-untouched) 'expired'
// bucket, so whichever job reaches a given subscription first sends it and the
// other is a no-op. Under normal operation this job always gets there first
// (the sweep's [-7,-1] window only starts a full day later); the sweep's
// branch is left in place purely as a backstop for when this job misses a run.
export async function expireLapsedSubscriptions(
  db: PrismaClient,
  notifications: NotificationsService,
): Promise<{ expired: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const subs = await db.subscription.findMany({
    where: { isActive: true, validUntil: { lt: today } },
    select: {
      id: true,
      communityId: true,
      approvedPhoneId: true,
      validUntil: true,
      user: { select: { id: true, name: true, phone: true, email: true } },
      community: { select: { name: true, paymentLink: true } },
    },
  })

  for (const sub of subs) {
    await db.$transaction([
      db.subscription.update({ where: { id: sub.id }, data: { isActive: false } }),
      db.approvedPhone.updateMany({
        where: { id: sub.approvedPhoneId, status: 'registered' },
        data: { status: 'expired' },
      }),
    ])

    const createdId = await notifyOnce({
      db, communityId: sub.communityId, userId: sub.user.id,
      type: NotificationType.SubscriptionExpired, sourceId: sub.id,
      title: 'Access paused',
      message: `Email support@finskool21.com to restore your ${sub.community.name} access.`,
    })
    if (createdId === null) continue // reminder sweep already notified for this subscription

    try {
      await notifications.sendSubscriptionExpiredEmail({
        toEmail: sub.user.email,
        name: sub.user.name,
        phone: sub.user.phone,
        communityName: sub.community.name,
        validTill: sub.validUntil.toISOString(),
        paymentLink: sub.community.paymentLink,
      })
    } catch (err) {
      logger.error({ err, subscriptionId: sub.id }, 'expireLapsedSubscriptions: email send failed')
    }
  }

  logger.info({ expired: subs.length }, 'expireLapsedSubscriptions: done')
  return { expired: subs.length }
}
