import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { notificationsQueue, PUSH_NOTIFICATION_JOB } from './queue.js'
import type { PushNotificationJobPayload } from './queue.js'
import { logger } from '../shared/logger.js'

export interface PushRequest {
  userIds: string[]
  title: string
  body: string
  data: Record<string, string>
  threadId?: string
}

/**
 * Queues a push for the given members. Never throws: a push is a nudge on top of the in-app
 * notification row, so a Redis hiccup must not fail the request that triggered it.
 * Recipients with pushing muted, or with no registered device, are filtered out by the worker.
 *
 * Returns whether the push is safely queued (true also when there was nothing to send). Callers that saved a
 * notification row should use `queuePushFor` instead, which also keeps the row's "push pending" flag honest.
 */
export async function enqueuePush(req: PushRequest): Promise<boolean> {
  if (req.userIds.length === 0) return true
  const payload: PushNotificationJobPayload = {
    userIds: req.userIds,
    title: req.title,
    body: req.body,
    data: req.data,
    ...(req.threadId ? { threadId: req.threadId } : {}),
  }
  try {
    await notificationsQueue.add(PUSH_NOTIFICATION_JOB, payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 500 },
    })
    return true
  } catch (err) {
    logger.error({ err, type: req.data['type'], count: req.userIds.length }, 'enqueuePush: failed to queue push job; it will be retried by the push-retry job')
    return false
  }
}

/**
 * Queues the push for notification rows that were saved with `pushPending: true`, then clears that flag. If the
 * queueing fails the flag stays on and `retryPendingPushes` queues the push later; if the process dies between
 * saving the row and getting here, the flag is still on and the same thing happens. `where` picks the rows.
 */
export async function queuePushFor(db: PrismaClient, where: Prisma.NotificationWhereInput, req: PushRequest): Promise<boolean> {
  if (!(await enqueuePush(req))) return false
  try {
    await db.notification.updateMany({ where, data: { pushPending: false } })
  } catch (err) {
    // The push is queued; only the flag is stale. The retry job may queue it a second time, which is the safe side.
    logger.error({ err }, 'queuePushFor: push queued but the pending flag could not be cleared')
  }
  return true
}

// ─── Retry of pushes that never got queued ──────────────────────────────────

/** Give the original attempt time to finish before treating a pending row as lost. */
const RETRY_AFTER_MS = 60_000
/** After this a push is pointless ("your quote is ready" two days late), so the row is dropped from the queue. */
const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000
const RETRY_BATCH = 1000
const USERS_PER_JOB = 500

/** The iOS conversation tag ticket and service pushes carry, rebuilt from the row's routing data. */
function threadIdOf(data: Record<string, string>): string | undefined {
  return (data['type'] === 'ticket' || data['type'] === 'service') && data['id'] ? `${data['type']}:${data['id']}` : undefined
}

/**
 * Queues the pushes of notification rows still marked pending (see `queuePushFor`). Rows that belong to the same
 * announcement (a post sent to a whole community) go out together as one job per 500 members.
 */
export async function retryPendingPushes(db: PrismaClient, now: Date = new Date()): Promise<{ requeued: number; abandoned: number }> {
  const giveUpBefore = new Date(now.getTime() - GIVE_UP_AFTER_MS)
  const abandoned = (await db.notification.updateMany({ where: { pushPending: true, createdAt: { lt: giveUpBefore } }, data: { pushPending: false } })).count

  const rows = await db.notification.findMany({
    where: { pushPending: true, createdAt: { gte: giveUpBefore, lt: new Date(now.getTime() - RETRY_AFTER_MS) } },
    orderBy: { createdAt: 'asc' },
    take: RETRY_BATCH,
    select: { id: true, userId: true, type: true, sourceId: true, title: true, message: true, data: true },
  })

  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.type}|${row.sourceId}|${row.title}|${row.message}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }

  let requeued = 0
  for (const group of groups.values()) {
    const first = group[0]!
    const data = (first.data as Record<string, string> | null) ?? {}
    const threadId = threadIdOf(data)
    for (let i = 0; i < group.length; i += USERS_PER_JOB) {
      const part = group.slice(i, i + USERS_PER_JOB)
      const queued = await queuePushFor(db, { id: { in: part.map(r => r.id) } }, {
        userIds: part.map(r => r.userId),
        title: first.title,
        body: first.message,
        data,
        ...(threadId ? { threadId } : {}),
      })
      if (queued) requeued += part.length
    }
  }
  if (requeued > 0 || abandoned > 0) logger.info({ requeued, abandoned }, 'push-retry: done')
  return { requeued, abandoned }
}
