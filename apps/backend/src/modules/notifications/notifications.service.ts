import type { PrismaClient } from '../../generated/prisma/client.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { sendMail } from '../../lib/mailer.js'
import redis from '../../lib/redis.js'
import { env } from '../../config/env.js'
import { renderEmail, firstNameOf, formatEmailDate, formatEmailAmount, buildEmailRows } from '../../lib/email-templates.js'
import {
  NOTIFICATIONS_PUBSUB_CHANNEL,
} from '../../lib/queue.js'
import type {
  CommunityPostNotificationJobPayload,
  CommunityRecommendationNotificationJobPayload,
  ThreadReplyEmailJobPayload,
  WelcomeEmailJobPayload,
  SubscriptionExtendedEmailJobPayload,
  CommunityAddedEmailJobPayload,
  CommunityAccessRemovedEmailJobPayload,
  NewMemberRegisteredEmailJobPayload,
  MemberSuspendedEmailJobPayload,
  MemberReinstatedEmailJobPayload,
  LiveNotificationEvent,
} from '../../lib/queue.js'
import { NotificationType } from './notifications.dto.js'
import type { ListNotificationsResponseDTO } from './notifications.dto.js'

const FAN_OUT_CHUNK_SIZE = 500

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

export interface SubscriptionExpiringEmailPayload {
  toEmail: string
  name: string
  phone: string
  communityName: string
  validTill: string
}

export interface AdminUnrepliedDigestEmailPayload {
  toEmail: string
  adminName: string
  count: number
  days: number
  communityName: string
  rows: { label: string; value: string }[]
}

export interface AdminExpiryDigestEmailPayload {
  toEmail: string
  adminName: string
  count: number
  dateFrom: string
  dateTo: string
  rows: { label: string; value: string }[]
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
        title: n.title,
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
    const community = await this.db.community.findUnique({ where: { id: payload.communityId }, select: { name: true } })
    const { subject, html } = renderEmail('new-announcement', {
      community_name: community?.name ?? '',
      post_title: payload.postTitle,
      post_excerpt: payload.postExcerpt,
      frontend_url: env.frontendUrl,
    })
    return this.fanOutCommunity({
      communityId: payload.communityId,
      sourceId: payload.postId,
      title: subject,
      message: payload.message,
      triggeredByUserId: payload.triggeredByUserId,
      type: NotificationType.Post,
      email: { subject, html },
    })
  }

  async fanOutCommunityRecommendation(payload: CommunityRecommendationNotificationJobPayload): Promise<{ created: number }> {
    const html = notificationEmailHtml(payload.message, `${env.frontendUrl}/recommendations`, 'View Recommendation')
    return this.fanOutCommunity({
      communityId: payload.communityId,
      sourceId: payload.recommendationId,
      title: `New recommendation — ${payload.stockSymbol}`,
      message: payload.message,
      triggeredByUserId: payload.triggeredByUserId,
      type: NotificationType.Recommendation,
      email: { subject: payload.message, html },
    })
  }

  private async fanOutCommunity(params: {
    communityId: string
    sourceId: string
    title: string
    message: string
    triggeredByUserId: string
    type: string
    email: { subject: string; html: string }
  }): Promise<{ created: number }> {
    const { communityId, sourceId, title, message, triggeredByUserId, type, email } = params

    const subs = await this.db.subscription.findMany({
      where: { communityId, isActive: true, validUntil: { gte: startOfToday() } },
      select: { userId: true, user: { select: { email: true, postNotificationsEnabled: true } } },
      distinct: ['userId'],
    })

    const recipients = subs
      .filter(s => s.userId !== triggeredByUserId && s.user.postNotificationsEnabled)
      .map(s => ({ userId: s.userId, email: s.user.email }))
    if (recipients.length === 0) return { created: 0 }

    let created = 0
    for (let i = 0; i < recipients.length; i += FAN_OUT_CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + FAN_OUT_CHUNK_SIZE)
      const result = await this.db.notification.createMany({
        data: chunk.map(r => ({
          communityId,
          userId: r.userId,
          type,
          sourceId,
          title,
          message,
        })),
        skipDuplicates: true,
      })
      created += result.count

      await Promise.all([
        this.sendEmailBatch(chunk.map(r => r.email), email.subject, email.html),
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
    const { subject, html } = renderEmail('thread-reply', {
      first_name: firstNameOf(payload.recipientName),
      admin_name: payload.adminName,
      post_title: payload.postTitle,
      reply_excerpt: payload.replyExcerpt,
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendWelcomeEmail(payload: WelcomeEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('welcome', {
      first_name: firstNameOf(payload.name),
      phone: payload.phone,
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExtendedEmail(payload: SubscriptionExtendedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('subscription-extended', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      amount: formatEmailAmount(payload.amount),
      paid_on: formatEmailDate(payload.paidOn),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendCommunityAddedEmail(payload: CommunityAddedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-added', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendCommunityAccessRemovedEmail(payload: CommunityAccessRemovedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-access-removed', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendNewMemberRegisteredEmail(payload: NewMemberRegisteredEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('admin-new-member', {
      admin_name: firstNameOf(payload.adminName),
      member_name: payload.memberName,
      phone: payload.phone,
      community_name: payload.communityName,
      registered_date: formatEmailDate(payload.registeredDate),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.adminEmail, subject, html })
  }

  async sendMemberSuspendedEmail(payload: MemberSuspendedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('member-suspended', {
      first_name: firstNameOf(payload.name),
      reason: payload.reason,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendMemberReinstatedEmail(payload: MemberReinstatedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('member-reinstated', {
      first_name: firstNameOf(payload.name),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExpiring7DaysEmail(payload: SubscriptionExpiringEmailPayload): Promise<void> {
    const { subject, html } = renderEmail('subscription-expiring-7-days', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      phone: payload.phone,
      community_name_urlenc: encodeURIComponent(payload.communityName),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExpiring1DayEmail(payload: SubscriptionExpiringEmailPayload): Promise<void> {
    const { subject, html } = renderEmail('subscription-expiring-1-day', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      phone: payload.phone,
      community_name_urlenc: encodeURIComponent(payload.communityName),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExpiredEmail(payload: SubscriptionExpiringEmailPayload): Promise<void> {
    const { subject, html } = renderEmail('subscription-expired', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      phone: payload.phone,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendAdminUnrepliedDigestEmail(payload: AdminUnrepliedDigestEmailPayload): Promise<void> {
    const { subject, html } = renderEmail('admin-unreplied-digest', {
      admin_name: firstNameOf(payload.adminName),
      count: String(payload.count),
      days: String(payload.days),
      community_name: payload.communityName,
      rows_html: buildEmailRows(payload.rows),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendAdminExpiryDigestEmail(payload: AdminExpiryDigestEmailPayload): Promise<void> {
    const dateFrom = formatEmailDate(payload.dateFrom)
    const dateTo = formatEmailDate(payload.dateTo)
    const { subject, html } = renderEmail('admin-expiry-report', {
      admin_name: firstNameOf(payload.adminName),
      count: String(payload.count),
      date_from: dateFrom,
      date_to: dateTo,
      date_range: `${dateFrom} – ${dateTo}`,
      rows_html: buildEmailRows(payload.rows),
      frontend_url: env.frontendUrl,
    })
    await sendMail({ to: payload.toEmail, subject, html })
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
