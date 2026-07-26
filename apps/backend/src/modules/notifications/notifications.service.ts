import type { PrismaClient } from '../../generated/prisma/client.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { sendMail } from '../../lib/mailer.js'
import redis from '../../lib/redis.js'
import { env } from '../../config/env.js'
import {
  NOTIFICATIONS_PUBSUB_CHANNEL,
} from '../../lib/queue.js'
import type {
  CommunityPostNotificationJobPayload,
  CommunityRecommendationNotificationJobPayload,
  ThreadReplyEmailJobPayload,
  WelcomeEmailJobPayload,
  LiveNotificationEvent,
} from '../../lib/queue.js'
import { NotificationType } from './notifications.dto.js'
import type { ListNotificationsResponseDTO } from './notifications.dto.js'

const FAN_OUT_CHUNK_SIZE = 500

const CTA_PATH_BY_TYPE: Record<string, string> = {
  [NotificationType.Post]: '/feed',
  [NotificationType.Recommendation]: '/recommendations',
}

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function notificationEmailHtml(message: string, ctaUrl: string, ctaLabel: string): string {
  return `
    <div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="font-size: 15px; color: #153d3a; line-height: 1.5;">${message}</p>
      <a href="${ctaUrl}"
         style="display: inline-block; margin-top: 12px; padding: 10px 24px; border-radius: 999px;
                background: linear-gradient(to right, #c1f26e, #108b8b); color: #153d3a;
                font-weight: 700; font-size: 14px; text-decoration: none;">
        ${ctaLabel}
      </a>
    </div>
  `
}

export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  async listForUser(userId: string, page: number, pageSize: number, communityId?: string): Promise<ListNotificationsResponseDTO> {
    const where = communityId ? { userId, communityId } : { userId }

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
    return this.fanOutCommunity({
      communityId: payload.communityId,
      sourceId: payload.postId,
      message: payload.message,
      triggeredByUserId: payload.triggeredByUserId,
      type: NotificationType.Post,
    })
  }

  async fanOutCommunityRecommendation(payload: CommunityRecommendationNotificationJobPayload): Promise<{ created: number }> {
    return this.fanOutCommunity({
      communityId: payload.communityId,
      sourceId: payload.recommendationId,
      message: payload.message,
      triggeredByUserId: payload.triggeredByUserId,
      type: NotificationType.Recommendation,
    })
  }

  private async fanOutCommunity(params: {
    communityId: string
    sourceId: string
    message: string
    triggeredByUserId: string
    type: string
  }): Promise<{ created: number }> {
    const { communityId, sourceId, message, triggeredByUserId, type } = params

    const subs = await this.db.subscription.findMany({
      where: { communityId, isActive: true, validUntil: { gte: startOfToday() } },
      select: { userId: true, user: { select: { email: true, postNotificationsEnabled: true } } },
      distinct: ['userId'],
    })

    const recipients = subs
      .filter(s => s.userId !== triggeredByUserId && s.user.postNotificationsEnabled)
      .map(s => ({ userId: s.userId, email: s.user.email }))
    if (recipients.length === 0) return { created: 0 }

    const ctaPath = CTA_PATH_BY_TYPE[type] ?? '/feed'
    const ctaUrl = `${env.frontendUrl}${ctaPath}`
    const ctaLabel = type === NotificationType.Recommendation ? 'View Recommendation' : 'View in Feed'
    const emailHtml = notificationEmailHtml(message, ctaUrl, ctaLabel)

    let created = 0
    for (let i = 0; i < recipients.length; i += FAN_OUT_CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + FAN_OUT_CHUNK_SIZE)
      const result = await this.db.notification.createMany({
        data: chunk.map(r => ({
          communityId,
          userId: r.userId,
          type,
          sourceId,
          message,
        })),
        skipDuplicates: true,
      })
      created += result.count

      await Promise.all([
        this.sendEmailBatch(chunk.map(r => r.email), message, emailHtml),
        this.publishLiveBatch(chunk.map(r => r.userId), { type, communityId, message, sourceId }),
      ])
    }

    logger.info(
      { communityId, sourceId, type, recipients: recipients.length, created },
      'notifications.fanOutCommunity: done',
    )
    return { created }
  }

  async sendThreadReplyEmail(payload: ThreadReplyEmailJobPayload): Promise<void> {
    await sendMail({ to: payload.toEmail, subject: payload.message, html: `<p>${payload.message}</p>` })
  }

  async sendWelcomeEmail(payload: WelcomeEmailJobPayload): Promise<void> {
    const ctaUrl = `${env.frontendUrl}/signup`
    const message = `Hi ${payload.name}, you've been added to Finskool. Register your account to get started.`
    await sendMail({
      to: payload.toEmail,
      subject: 'You’ve been added to Finskool',
      html: notificationEmailHtml(message, ctaUrl, 'Register Now'),
    })
  }

  // Email delivery failures shouldn't fail the job (the in-app rows above already
  // succeeded, and BullMQ would otherwise retry the whole batch on any SMTP hiccup).
  private async sendEmailBatch(emails: string[], subject: string, html: string): Promise<void> {
    const results = await Promise.allSettled(
      emails.map(email => sendMail({ to: email, subject, html })),
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) logger.error({ failed, total: emails.length }, 'notifications.sendEmailBatch: some emails failed')
  }

  // Best-effort: this service runs in the worker process, which has no direct
  // access to the API process's live WebSocket connections. Publishing to Redis
  // is how lib/live-notifications-feed.ts (running in the API process) finds out.
  private async publishLiveBatch(
    userIds: string[],
    rest: Omit<LiveNotificationEvent, 'userId'>,
  ): Promise<void> {
    try {
      await Promise.all(
        userIds.map(userId =>
          redis.publish(NOTIFICATIONS_PUBSUB_CHANNEL, JSON.stringify({ userId, ...rest } satisfies LiveNotificationEvent)),
        ),
      )
    } catch (err) {
      logger.error({ err }, 'notifications.publishLiveBatch: failed')
    }
  }
}
