import type { PrismaClient } from '../../generated/prisma/client.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { sendMail } from '../../lib/mailer.js'
import type { CommunityPostNotificationJobPayload, ThreadReplyEmailJobPayload } from '../../lib/queue.js'
import { NotificationType } from './notifications.dto.js'
import type { ListNotificationsResponseDTO } from './notifications.dto.js'

const FAN_OUT_CHUNK_SIZE = 500

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  async listForUser(userId: string, page: number, pageSize: number): Promise<ListNotificationsResponseDTO> {
    const where = { userId }

    const [notifications, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.notification.count({ where }),
    ])

    return {
      notifications: notifications.map(n => ({
        id: n.id,
        communityId: n.communityId,
        type: n.type,
        message: n.message,
        isRead: n.isRead,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({ where: { userId, isRead: false } })
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    })
    if (result.count === 0) throw new NotFoundError('Notification not found')
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    return { count: result.count }
  }

  async fanOutCommunityPost(payload: CommunityPostNotificationJobPayload): Promise<{ created: number }> {
    const subs = await this.db.subscription.findMany({
      where: { communityId: payload.communityId, isActive: true, validUntil: { gte: startOfToday() } },
      select: { userId: true, user: { select: { email: true } } },
      distinct: ['userId'],
    })

    const recipients = subs
      .filter(s => s.userId !== payload.triggeredByUserId)
      .map(s => ({ userId: s.userId, email: s.user.email }))
    if (recipients.length === 0) return { created: 0 }

    let created = 0
    for (let i = 0; i < recipients.length; i += FAN_OUT_CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + FAN_OUT_CHUNK_SIZE)
      const result = await this.db.notification.createMany({
        data: chunk.map(r => ({
          communityId: payload.communityId,
          userId: r.userId,
          type: NotificationType.Post,
          sourceId: payload.postId,
          message: payload.message,
        })),
        skipDuplicates: true,
      })
      created += result.count

      await this.sendEmailBatch(chunk.map(r => r.email), payload.message)
    }

    logger.info(
      { communityId: payload.communityId, postId: payload.postId, recipients: recipients.length, created },
      'notifications.fanOutCommunityPost: done',
    )
    return { created }
  }

  async sendThreadReplyEmail(payload: ThreadReplyEmailJobPayload): Promise<void> {
    await sendMail({ to: payload.toEmail, subject: payload.message, html: `<p>${payload.message}</p>` })
  }

  // Email delivery failures shouldn't fail the job (the in-app rows above already
  // succeeded, and BullMQ would otherwise retry the whole batch on any SMTP hiccup).
  private async sendEmailBatch(emails: string[], message: string): Promise<void> {
    const results = await Promise.allSettled(
      emails.map(email =>
        sendMail({ to: email, subject: message, html: `<p>${message}</p>` }),
      ),
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) logger.error({ failed, total: emails.length }, 'notifications.sendEmailBatch: some emails failed')
  }
}
