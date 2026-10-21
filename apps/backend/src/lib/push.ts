import { notificationsQueue, PUSH_NOTIFICATION_JOB } from './queue.js'
import type { PushNotificationJobPayload } from './queue.js'
import { logger } from '../shared/logger.js'

export interface PushRequest {
  userIds: string[]
  title: string
  body: string
  data: Record<string, string>
  collapseKey?: string
}

/**
 * Queues a push for the given members. Never throws: a push is a nudge on top of the in-app
 * notification row, so a Redis hiccup must not fail the request that triggered it.
 * Recipients with pushing muted, or with no registered device, are filtered out by the worker.
 */
export async function enqueuePush(req: PushRequest): Promise<void> {
  if (req.userIds.length === 0) return
  const payload: PushNotificationJobPayload = {
    userIds: req.userIds,
    title: req.title,
    body: req.body,
    data: req.data,
    ...(req.collapseKey ? { collapseKey: req.collapseKey } : {}),
  }
  try {
    await notificationsQueue.add(PUSH_NOTIFICATION_JOB, payload, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: { count: 500 },
    })
  } catch (err) {
    logger.error({ err, type: req.data['type'], count: req.userIds.length }, 'enqueuePush: failed to queue push job')
  }
}
