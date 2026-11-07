import type { Prisma } from '../generated/prisma/client.js'
import { notifyAdmins } from './admin-notify.js'
import type { AdminNotification } from './admin-notify.js'
import { ADMIN_PAYMENT_EMAIL_JOB, notificationsQueue } from './queue.js'
import type { AdminPaymentEmailJobPayload } from './queue.js'
import { logger } from '../shared/logger.js'

/** The amount as the admin inbox and the admin emails print it: ₹4,999, or ₹4,999.50 when there are paise. */
export function rupeesLabel(amount: Prisma.Decimal | number | string): string {
  return `₹${Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

/**
 * Tells admins that a member paid: the inbox row and live event of `notifyAdmins`, and an email to each admin
 * who was just told. The email follows the inbox row on purpose: an admin who already has this exact event
 * (the same payment seen by the app and the webhook, say) is not mailed again.
 *
 * Never throws; this is a side effect of the member's payment and must not fail it. A mail that cannot be
 * queued is logged and does not take the inbox row with it.
 */
export async function notifyAdminsOfPayment(
  inbox: AdminNotification,
  email: Omit<AdminPaymentEmailJobPayload, 'adminEmail' | 'adminName'>,
): Promise<void> {
  const told = await notifyAdmins(inbox)
  if (told.length === 0) return

  try {
    const admins = await inbox.db.user.findMany({
      where: { id: { in: told }, email: { not: null } },
      select: { name: true, email: true },
    })
    const queued = await Promise.allSettled(
      admins.map(admin =>
        notificationsQueue.add(
          ADMIN_PAYMENT_EMAIL_JOB,
          { ...email, adminEmail: admin.email!, adminName: admin.name },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
        ),
      ),
    )
    for (const result of queued) {
      if (result.status === 'rejected') {
        logger.error({ err: result.reason, type: inbox.type, sourceId: inbox.sourceId }, 'notifyAdminsOfPayment: failed to enqueue email job')
      }
    }
  } catch (err) {
    logger.error({ err, type: inbox.type, sourceId: inbox.sourceId }, 'notifyAdminsOfPayment: failed to queue emails')
  }
}
