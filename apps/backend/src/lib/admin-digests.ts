import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '../generated/prisma/client.js'
import { formatEmailDate } from './email-templates.js'
import { getAccessibleCommunityIds } from './community-access.js'
import { createAndPublishNotification } from './notify-once.js'
import { logger } from '../shared/logger.js'
import { NotificationType } from '../modules/notifications/notifications.dto.js'
import type { NotificationsService } from '../modules/notifications/notifications.service.js'

export async function runAdminUnrepliedDigest(
  db: PrismaClient,
  notifications: NotificationsService,
): Promise<{ digestsSent: number }> {
  // Fetched once, filtered per-admin in memory below — avoids an N+1 query
  // against commentNotification for every admin.
  const unreplied = await db.commentNotification.findMany({
    where: { isReplied: false },
    select: { createdAt: true, post: { select: { communityId: true, community: { select: { name: true } } } } },
  })
  if (unreplied.length === 0) return { digestsSent: 0 }

  const admins = await db.user.findMany({
    where: { role: 'admin', deletedAt: null },
    select: { id: true, name: true, email: true },
  })

  let digestsSent = 0
  for (const admin of admins) {
    if (!admin.email) continue // shouldn't happen — admin accounts always require email
    const accessibleCommunityIds = await getAccessibleCommunityIds(db, admin.id)
    const scoped = accessibleCommunityIds === null
      ? unreplied
      : unreplied.filter(r => accessibleCommunityIds.includes(r.post.communityId))
    if (scoped.length === 0) continue // nothing to report for this admin

    const byCommunity = new Map<string, { name: string; count: number; oldest: Date }>()
    for (const row of scoped) {
      const key = row.post.communityId
      const existing = byCommunity.get(key)
      if (existing) {
        existing.count++
        if (row.createdAt < existing.oldest) existing.oldest = row.createdAt
      } else {
        byCommunity.set(key, { name: row.post.community.name, count: 1, oldest: row.createdAt })
      }
    }

    let oldestCommunityId = ''
    let oldestCommunityName = ''
    let oldestDate: Date | null = null
    for (const [communityId, agg] of byCommunity) {
      if (oldestDate === null || agg.oldest < oldestDate) {
        oldestDate = agg.oldest
        oldestCommunityId = communityId
        oldestCommunityName = agg.name
      }
    }
    const daysOld = Math.floor((Date.now() - oldestDate!.getTime()) / (1000 * 60 * 60 * 24))
    const rows = Array.from(byCommunity.values())
      .sort((a, b) => b.count - a.count) // busiest community first
      .map(c => ({ label: c.name, value: `${c.count} unreplied` }))

    // Fresh sourceId every run — this is a periodic REPORT, not a one-time
    // lifecycle event, so today's digest is never a "duplicate" of
    // yesterday's; mirrors admin.service.ts's notifyImportComplete pattern.
    await createAndPublishNotification({
      db,
      communityId: oldestCommunityId, // anchor: same community named in the in-app body below
      userId: admin.id,
      type: NotificationType.AdminUnrepliedDigest,
      sourceId: randomUUID(),
      title: `${scoped.length} threads waiting for a reply`,
      message: `Oldest is ${daysOld} days old in ${oldestCommunityName}.`,
    })

    try {
      await notifications.sendAdminUnrepliedDigestEmail({
        toEmail: admin.email,
        adminName: admin.name,
        count: scoped.length,
        days: daysOld,
        communityName: oldestCommunityName,
        rows,
      })
    } catch (err) {
      logger.error({ err, adminId: admin.id }, 'adminUnrepliedDigest: email send failed')
    }
    digestsSent++
  }

  logger.info({ digestsSent }, 'adminUnrepliedDigest: done')
  return { digestsSent }
}

export async function runAdminExpiryDigest(
  db: PrismaClient,
  notifications: NotificationsService,
): Promise<{ digestsSent: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sevenDaysLater = new Date(today)
  sevenDaysLater.setDate(today.getDate() + 7)

  const expiring = await db.subscription.findMany({
    where: { isActive: true, validUntil: { gte: today, lte: sevenDaysLater } },
    select: { communityId: true, validUntil: true, community: { select: { name: true } } },
  })
  if (expiring.length === 0) return { digestsSent: 0 }

  const admins = await db.user.findMany({
    where: { role: 'admin', deletedAt: null },
    select: { id: true, name: true, email: true },
  })

  let digestsSent = 0
  for (const admin of admins) {
    if (!admin.email) continue // shouldn't happen — admin accounts always require email
    const accessibleCommunityIds = await getAccessibleCommunityIds(db, admin.id)
    const scoped = accessibleCommunityIds === null
      ? expiring
      : expiring.filter(s => accessibleCommunityIds.includes(s.communityId))
    if (scoped.length === 0) continue

    const byCommunity = new Map<string, { name: string; count: number }>()
    let earliestDate: Date | null = null
    let earliestCommunityId = ''
    for (const sub of scoped) {
      const existing = byCommunity.get(sub.communityId)
      if (existing) existing.count++
      else byCommunity.set(sub.communityId, { name: sub.community.name, count: 1 })
      if (earliestDate === null || sub.validUntil < earliestDate) {
        earliestDate = sub.validUntil
        earliestCommunityId = sub.communityId
      }
    }
    const rows = Array.from(byCommunity.values())
      .sort((a, b) => b.count - a.count)
      .map(c => ({ label: c.name, value: `${c.count} expiring` }))

    await createAndPublishNotification({
      db,
      communityId: earliestCommunityId,
      userId: admin.id,
      type: NotificationType.AdminExpiryReport,
      sourceId: randomUUID(),
      title: `${scoped.length} subscriptions expiring this week`,
      message: `Review and extend before ${formatEmailDate(earliestDate!)}`,
    })

    try {
      await notifications.sendAdminExpiryDigestEmail({
        toEmail: admin.email,
        adminName: admin.name,
        count: scoped.length,
        dateFrom: today.toISOString(),
        dateTo: sevenDaysLater.toISOString(),
        rows,
      })
    } catch (err) {
      logger.error({ err, adminId: admin.id }, 'adminExpiryDigest: email send failed')
    }
    digestsSent++
  }

  logger.info({ digestsSent }, 'adminExpiryDigest: done')
  return { digestsSent }
}
