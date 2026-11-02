import type { PrismaClient } from '../generated/prisma/client.js'
import { logger } from '../shared/logger.js'

/** Read notifications older than this are deleted by the daily job. Unread ones are never touched. */
export const NOTIFICATION_RETENTION_DAYS = 90

// Deleted in slices so one run never holds a long lock; a hard cap keeps a first run on a huge table from going on all
// night (the rest is simply picked up the next day).
const BATCH_SIZE = 5000
const MAX_BATCHES = 200

/**
 * Keeps the notifications table from growing forever (every ticket and service message is a row). Removes rows the
 * member has read and that are older than NOTIFICATION_RETENTION_DAYS.
 *
 * Safe for the "send once" rules: those key on a source that is already long over by then (a subscription whose
 * reminders ended weeks ago, a post announced months ago).
 */
export async function cleanupOldNotifications(db: PrismaClient, now: Date = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 3600e3)
  let deleted = 0
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const removed = await db.$executeRaw`
      DELETE FROM notifications
      WHERE id IN (
        SELECT id FROM notifications
        WHERE is_read = true AND created_at < ${cutoff}
        ORDER BY created_at
        LIMIT ${BATCH_SIZE}
      )`
    deleted += removed
    if (removed < BATCH_SIZE) break
  }
  logger.info({ deleted, olderThan: cutoff.toISOString() }, 'notification-cleanup: done')
  return { deleted }
}
