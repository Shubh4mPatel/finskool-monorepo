import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { visibleNotifications } from '../../lib/community-block.js'
import { refreshAdminBadges } from '../../lib/admin-badges.js'
import { decodeCursor, encodeCursor } from '../tickets/tickets.shared.js'
import { NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { sendMail } from '../../lib/mailer.js'
import redis from '../../lib/redis.js'
import { env } from '../../config/env.js'
import { renderEmail, firstNameOf, formatEmailDate, formatEmailDateTime, formatEmailAmount, buildEmailRows, buildRenewalCta } from '../../lib/email-templates.js'
import { sendWhatsappOtp } from '../../lib/whatsapp.js'
import {
  NOTIFICATIONS_PUBSUB_CHANNEL,
} from '../../lib/queue.js'
import type {
  CommunityPostNotificationJobPayload,
  WelcomeEmailJobPayload,
  SubscriptionExtendedEmailJobPayload,
  SubscriptionReducedEmailJobPayload,
  ServiceInvoiceEmailJobPayload,
  CommunityAddedEmailJobPayload,
  CommunityAccessRemovedEmailJobPayload,
  CommunityBlockedEmailJobPayload,
  CommunityUnblockedEmailJobPayload,
  NewMemberRegisteredEmailJobPayload,
  AdminPaymentEmailJobPayload,
  MemberSuspendedEmailJobPayload,
  MemberPasswordResetEmailJobPayload,
  MemberReinstatedEmailJobPayload,
  OtpEmailJobPayload,
  OtpWhatsappJobPayload,
  PasswordResetOtpEmailJobPayload,
  MobileNewLoginEmailJobPayload,
  LiveNotificationEvent,
  PushNotificationJobPayload,
} from '../../lib/queue.js'
import { FCM_BATCH_SIZE, isPushConfigured, sendPushBatch } from '../../lib/fcm.js'
import { queuePushFor } from '../../lib/push.js'
import { ensureInvoicePdf, renderInvoicePdf } from '../services/services.invoice.js'
import { ensureReceiptPdf, renderReceiptPdf } from '../../lib/plan-receipt.js'
import { requestLabel } from '../services/services.shared.js'
import { routingData, RoutingModule } from '../../lib/notification-routing.js'
import type { RoutingData } from '../../lib/notification-routing.js'
import { NotificationType, toNotificationItem } from './notifications.dto.js'
import type { ListNotificationsResponseDTO } from './notifications.dto.js'
import { notExpired } from '../../lib/subscription-expiry.js'

const FAN_OUT_CHUNK_SIZE = 500

function startOfToday(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export interface SubscriptionExpiringEmailPayload {
  toEmail: string
  name: string
  phone: string
  communityName: string
  validTill: string
  paymentLink: string | null
}

export class NotificationsService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The inbox, newest first (createdAt, then id, so the order is total).
   *
   * Two ways to page:
   *  - `cursor` (use this in the app): "the items older than this one". New notifications arriving at the top cannot
   *    shift anything, so no item repeats or is skipped. Totals are not computed.
   *  - page numbers (the website): `skip` + `take`, with totals. Kept as it was.
   * Both return `nextCursor`, so a client can start with page 1 and continue by cursor.
   *
   * `unreadFirst` (the admin page asks for it) puts every unread notification before the read ones, each group newest
   * first, so what sits under "New" is exactly the unread count. Its cursor remembers which group the last item was
   * in (a `u.` / `r.` prefix), because the next page continues after it inside that group, or starts the read group.
   */
  async listForUser(
    userId: string,
    page: number,
    pageSize: number,
    communityId?: string,
    cursor?: string,
    unreadFirst = false,
  ): Promise<ListNotificationsResponseDTO> {
    const base = communityId ? { userId, communityId } : { userId }
    const afterRead = unreadFirst && cursor !== undefined && cursor.startsWith('r.')
    const after = cursor ? decodeCursor(unreadFirst ? cursor.slice(2) : cursor) : null
    const olderThanCursor = after
      ? { OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] }
      : null
    // Never shows what belongs to a community the member is blocked from, including rows from before the block.
    const where: Prisma.NotificationWhereInput = {
      AND: [
        base,
        visibleNotifications(userId),
        ...(olderThanCursor
          ? [
              unreadFirst
                ? // After an unread item: the rest of the unread ones, then all the read ones. After a read item: older read ones.
                  { OR: [...(afterRead ? [] : [{ isRead: true }]), { isRead: afterRead, ...olderThanCursor }] }
                : olderThanCursor,
            ]
          : []),
      ],
    }
    const orderBy = unreadFirst
      ? [{ isRead: 'asc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }]

    // One extra row tells us whether anything older exists, without counting.
    const [fetched, total] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy,
        ...(after ? {} : { skip: (page - 1) * pageSize }),
        take: pageSize + 1,
        include: { community: { select: { isFree: true } } },
      }),
      after ? Promise.resolve(null) : this.db.notification.count({ where }),
    ])
    const notifications = fetched.slice(0, pageSize)
    const last = notifications[notifications.length - 1]
    const plainCursor = last ? encodeCursor(last.createdAt, last.id) : null
    const nextCursor = fetched.length > pageSize && last && plainCursor ? (unreadFirst ? `${last.isRead ? 'r' : 'u'}.${plainCursor}` : plainCursor) : null

    const postIds = await this.postIdsFor(notifications)

    return {
      notifications: notifications.map(n => {
        const postId = postIds.get(n.id)
        const data = postId
          ? routingData({ module: RoutingModule.Post, id: postId, communityId: n.communityId, free: n.community?.isFree })
          : n.data
        return toNotificationItem({ ...n, data })
      }),
      pageSize,
      nextCursor,
      ...(total === null ? {} : { total, page, totalPages: Math.max(1, Math.ceil(total / pageSize)) }),
    }
  }

  /**
   * Reaction and reply notifications only store the reaction's / comment's id (their `sourceId`), so the
   * post they are about is looked up here — which also covers rows from before this was done. Only rows
   * with no routing `data` of their own are touched. A reaction or comment whose post was deleted drops out.
   */
  private async postIdsFor(rows: { id: string; type: string; sourceId: string; data: unknown }[]): Promise<Map<string, string>> {
    const open = rows.filter(r => r.data === null)
    const sourceIdsOf = (...types: string[]) => open.filter(r => types.includes(r.type)).map(r => r.sourceId)
    const reactionIds = sourceIdsOf(NotificationType.Reaction)
    const commentIds = sourceIdsOf(NotificationType.Thread, NotificationType.NewMemberReply)

    const [reactions, comments] = await Promise.all([
      reactionIds.length
        ? this.db.reaction.findMany({ where: { id: { in: reactionIds } }, select: { id: true, postId: true } })
        : [],
      commentIds.length
        ? this.db.comment.findMany({ where: { id: { in: commentIds } }, select: { id: true, postId: true } })
        : [],
    ])
    const postOfSource = new Map([...reactions, ...comments].map(x => [x.id, x.postId]))

    const byNotification = new Map<string, string>()
    for (const r of open) {
      const postId = postOfSource.get(r.sourceId)
      if (postId) byNotification.set(r.id, postId)
    }
    return byNotification
  }

  async unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({ where: { userId, isRead: false, ...visibleNotifications(userId) } })
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.db.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    })
    if (result.count === 0) throw new NotFoundError('Notification not found')
    // The unread count moved: every tab and device this admin has open updates its badge.
    await refreshAdminBadges([userId])
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })
    if (result.count > 0) await refreshAdminBadges([userId])
    return { count: result.count }
  }

  async fanOutCommunityPost(payload: CommunityPostNotificationJobPayload): Promise<{ created: number }> {
    const community = await this.db.community.findUnique({ where: { id: payload.communityId }, select: { name: true, isFree: true } })
    const { subject, html } = renderEmail('new-announcement', {
      // The free community's content is the general feed, so members see "in feed" rather than the community name.
      community_name: community?.isFree ? 'feed' : (community?.name ?? ''),
      post_title: payload.postTitle,
      post_excerpt: payload.postExcerpt,
    })
    return this.fanOutCommunity({
      communityId: payload.communityId,
      sourceId: payload.postId,
      title: subject,
      message: payload.message,
      triggeredByUserId: payload.triggeredByUserId,
      type: NotificationType.Post,
      data: routingData({ module: RoutingModule.Post, id: payload.postId, communityId: payload.communityId, free: community?.isFree }),
      email: { subject, html },
      push: true,
    })
  }

  private async fanOutCommunity(params: {
    communityId: string
    sourceId: string
    title: string
    message: string
    triggeredByUserId: string
    type: string
    data: RoutingData
    email: { subject: string; html: string }
    push: boolean
  }): Promise<{ created: number }> {
    const { communityId, sourceId, title, message, triggeredByUserId, type, data, email, push } = params

    const subs = await this.db.subscription.findMany({
      // Only members who can use the app: a suspended or deleted member gets no inbox row, email or push.
      where: { communityId, isActive: true, ...notExpired(startOfToday()), user: { status: 'active', deletedAt: null, communityBlocks: { none: { communityId } } } },
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
      // The database tells us which rows it really created. A member who already has this notification (the job
      // is being retried after a crash, or the post was announced before) is skipped by everything below, so
      // nobody gets the same email, live event or push twice.
      const createdRows = await this.db.notification.createManyAndReturn({
        select: { id: true, userId: true },
        data: chunk.map(r => ({
          communityId,
          userId: r.userId,
          type,
          sourceId,
          title,
          message,
          data,
          // Until the push job is queued (see queuePushFor), so a push that fails to queue is retried.
          pushPending: push,
        })),
        skipDuplicates: true,
      })
      created += createdRows.length
      if (createdRows.length === 0) continue
      const newUserIds = new Set(createdRows.map(r => r.userId))
      const fresh = chunk.filter(r => newUserIds.has(r.userId))

      // In-app notification rows above go to everyone new in the chunk regardless of email —
      // only the email send itself needs to skip members with no address on file.
      const emails = fresh.map(r => r.email).filter((e): e is string => e !== null)
      await Promise.all([
        this.sendEmailBatch(emails, email.subject, email.html),
        this.publishLiveBatch(fresh.map(r => r.userId), { type, communityId, message, sourceId }),
        push
          ? queuePushFor(this.db, { id: { in: createdRows.map(r => r.id) } }, { userIds: fresh.map(r => r.userId), title, body: message, data })
          : Promise.resolve(),
      ])
    }

    logger.info(
      { communityId, sourceId, type, recipients: recipients.length, created },
      'notifications.fanOutCommunity: done',
    )
    return { created }
  }

  async sendWelcomeEmail(payload: WelcomeEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('welcome', {
      first_name: firstNameOf(payload.name),
      phone: payload.phone,
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
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
    })
    await sendMail({ to: payload.toEmail, subject, html, ...(await this.receiptAttachments(payload.receiptId)) })
  }

  async sendSubscriptionReducedEmail(payload: SubscriptionReducedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('subscription-reduced', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      previous_valid_till: formatEmailDate(payload.previousValidTill),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  /** The payment receipt as an email attachment; nothing when there is none (an admin grant) or it can no longer be found. */
  private async receiptAttachments(receiptId: string | undefined) {
    if (!receiptId) return {}
    const receipt = await this.db.planReceipt.findUnique({ where: { id: receiptId } })
    if (!receipt) return {}
    const content = await renderReceiptPdf(receipt)
    ensureReceiptPdf(this.db, receipt.id).catch(err => logger.error({ err, receiptId: receipt.id }, 'receipt: storing the PDF failed'))
    return { attachments: [{ filename: `${receipt.number.replace(/\//g, '-')}.pdf`, content, contentType: 'application/pdf' }] }
  }

  /** "Payment received" with the GST invoice attached. The PDF is rendered here, so it needs no stored file. */
  async sendServiceInvoiceEmail(payload: ServiceInvoiceEmailJobPayload): Promise<void> {
    const invoice = await this.db.serviceInvoice.findUnique({
      where: { id: payload.invoiceId },
      include: { request: { select: { number: true, service: { select: { title: true } } } } },
    })
    if (!invoice) throw new NotFoundError('Invoice not found')
    const pdf = await renderInvoicePdf(invoice)
    // Keep a copy in the invoices bucket (the member / admin download link uses it); never blocks the email.
    ensureInvoicePdf(this.db, invoice.id).catch(err => logger.error({ err, invoiceId: invoice.id }, 'service invoice: storing the PDF failed'))
    const { subject, html } = renderEmail('service-invoice', {
      first_name: firstNameOf(payload.name),
      service_title: invoice.request.service.title,
      request_label: requestLabel(invoice.request.number),
      invoice_number: invoice.number,
      amount: Number(invoice.total).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      paid_on: formatEmailDate(invoice.issuedAt),
    })
    await sendMail({
      to: payload.toEmail,
      subject,
      html,
      attachments: [{ filename: `${invoice.number.replace(/\//g, '-')}.pdf`, content: pdf, contentType: 'application/pdf' }],
    })
  }

  async sendCommunityAddedEmail(payload: CommunityAddedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-added', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
    })
    await sendMail({ to: payload.toEmail, subject, html, ...(await this.receiptAttachments(payload.receiptId)) })
  }

  async sendCommunityAccessRemovedEmail(payload: CommunityAccessRemovedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-access-removed', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendCommunityBlockedEmail(payload: CommunityBlockedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-blocked', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      reason: payload.reason,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendCommunityUnblockedEmail(payload: CommunityUnblockedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('community-unblocked', {
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

  async sendAdminPaymentEmail(payload: AdminPaymentEmailJobPayload): Promise<void> {
    const review = payload.kind === 'review'
    const { subject, html } = renderEmail('admin-payment', {
      admin_name: firstNameOf(payload.adminName),
      headline: review ? `Payment needs review: ${payload.memberName} paid ${payload.amount}` : `${payload.memberName} paid ${payload.amount}`,
      badge_text: review ? 'Needs review' : 'Payment received',
      badge_bg: review ? '#FFF1D6' : '#E3F6D0',
      badge_color: review ? '#8A5A00' : '#2F6B12',
      intro: review
        ? `${payload.memberName} paid ${payload.amount} for ${payload.item}, but the payment could not be applied automatically. Please open it and refund or resolve it.`
        : `${payload.memberName} just paid ${payload.amount} for ${payload.item}.`,
      member_name: payload.memberName,
      item: payload.item,
      amount: payload.amount,
      paid_on: formatEmailDate(payload.paidOn),
      button_label: review ? 'Review payment' : 'View details',
      frontend_url: env.frontendUrl,
      path: payload.path,
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

  /** The new password an admin set, so the member can sign in and change it. */
  async sendMemberPasswordResetEmail(payload: MemberPasswordResetEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('member-password-reset', {
      first_name: firstNameOf(payload.name),
      new_password: payload.newPassword,
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendMemberReinstatedEmail(payload: MemberReinstatedEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('member-reinstated', {
      first_name: firstNameOf(payload.name),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendOtpEmail(payload: OtpEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('otp-verification', {
      first_name: firstNameOf(payload.name),
      otp_code: payload.otp,
      expiry_minutes: String(payload.expiryMinutes),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  /**
   * `isFinalAttempt` is true on the job's last BullMQ attempt. The email fallback
   * (WHATSAPP_EMAIL_FALLBACK_ENABLED) only kicks in then, so a transient WhatsApp
   * blip that a retry would fix never results in the user getting the code twice.
   * If the fallback email also fails, that error is thrown so the job is marked failed.
   */
  async sendOtpWhatsapp(payload: OtpWhatsappJobPayload, isFinalAttempt = true): Promise<void> {
    try {
      await sendWhatsappOtp(payload.phone, payload.otp)
    } catch (err) {
      if (!isFinalAttempt || !env.whatsapp.emailFallback || !payload.email) throw err
      logger.warn({ err, email: payload.email }, 'WhatsApp OTP delivery failed — falling back to email')
      await this.sendOtpEmail({
        toEmail: payload.email,
        name: payload.name ?? '',
        otp: payload.otp,
        expiryMinutes: payload.expiryMinutes ?? 10,
      })
    }
  }

  async sendPasswordResetOtpEmail(payload: PasswordResetOtpEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('password-reset-otp', {
      first_name: firstNameOf(payload.name),
      otp_code: payload.otp,
      expiry_minutes: String(payload.expiryMinutes),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  /**
   * Delivers one push job. Recipients who muted pushes, or have no registered device, are skipped.
   * Tokens FCM reports as dead are cleared (never retried). If some sends failed for a temporary reason,
   * the job's recipients are narrowed to just those members and the job is failed so BullMQ retries it,
   * which means a retry never re-sends to someone who already got it.
   */
  async sendPush(payload: PushNotificationJobPayload, job?: { updateData(data: PushNotificationJobPayload): Promise<void> }): Promise<{ sent: number; invalid: number; skipped: number }> {
    const sessions = await this.db.mobileSession.findMany({
      where: { userId: { in: payload.userIds }, fcmToken: { not: null }, user: { pushEnabled: true, status: 'active', deletedAt: null } },
      select: { userId: true, fcmToken: true },
    })
    const targets = sessions.flatMap(s => (s.fcmToken ? [{ userId: s.userId, token: s.fcmToken }] : []))
    const skipped = payload.userIds.length - targets.length
    if (targets.length === 0) return { sent: 0, invalid: 0, skipped }
    if (!isPushConfigured()) {
      logger.warn({ recipients: targets.length, type: payload.data['type'] }, 'notifications.sendPush: FCM not configured, push skipped')
      return { sent: 0, invalid: 0, skipped: payload.userIds.length }
    }

    let sent = 0
    const deadTokens: string[] = []
    const retryUserIds: string[] = []
    // Failures that are not about the token (a bad message, bad credentials): counted per reason and logged once,
    // never per member, and the tokens are kept.
    const failures = new Map<string, { code: string; message: string; count: number }>()
    for (let i = 0; i < targets.length; i += FCM_BATCH_SIZE) {
      const chunk = targets.slice(i, i + FCM_BATCH_SIZE)
      const outcomes = await sendPushBatch(
        chunk.map(t => ({ token: t.token, title: payload.title, body: payload.body, data: payload.data, threadId: payload.threadId })),
      )
      outcomes.forEach((outcome, idx) => {
        const target = chunk[idx]
        if (!target) return
        if (outcome.ok) sent++
        else if (outcome.kind === 'invalid-token') deadTokens.push(target.token)
        else if (outcome.kind === 'transient') retryUserIds.push(target.userId)
        else {
          const key = `${outcome.code}|${outcome.message}`
          const seen = failures.get(key)
          if (seen) seen.count++
          else failures.set(key, { code: outcome.code, message: outcome.message, count: 1 })
        }
      })
    }

    for (const f of failures.values()) {
      logger.error(
        { code: f.code, firebaseMessage: f.message, failedSends: f.count, pushType: payload.data['type'], event: payload.data['event'], titleLength: payload.title.length, bodyLength: payload.body.length, dataKeys: Object.keys(payload.data) },
        'notifications.sendPush: Firebase rejected the message itself, so the device tokens were KEPT; fix the message',
      )
    }

    if (deadTokens.length > 0) {
      logger.info({ cleared: deadTokens.length, pushType: payload.data['type'] }, 'notifications.sendPush: clearing tokens Firebase says are dead')
      await this.db.mobileSession.updateMany({ where: { fcmToken: { in: deadTokens } }, data: { fcmToken: null, fcmTokenUpdatedAt: null } })
    }
    if (retryUserIds.length > 0) {
      await job?.updateData({ ...payload, userIds: retryUserIds })
      throw new Error(`push: ${retryUserIds.length} send(s) failed temporarily; will retry`)
    }
    return { sent, invalid: deadTokens.length, skipped }
  }

  async sendMobileNewLoginEmail(payload: MobileNewLoginEmailJobPayload): Promise<void> {
    const { subject, html } = renderEmail('mobile-new-login', {
      first_name: firstNameOf(payload.name),
      device_name: payload.deviceName,
      // " from Mumbai, India" in the sentence; nothing at all when the app did not say where.
      location_phrase: payload.location ? ` from ${payload.location}` : '',
      rows_html: buildEmailRows([
        { label: 'Device', value: payload.deviceName },
        ...(payload.location ? [{ label: 'Location', value: payload.location }] : []),
        { label: 'Time', value: formatEmailDateTime(payload.loginAt) },
      ]),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExpiring7DaysEmail(payload: SubscriptionExpiringEmailPayload): Promise<void> {
    const mailtoHref = `mailto:support@finskool21.com?subject=Renewal%20request%20-%20${encodeURIComponent(payload.communityName)}&amp;body=Registered%20number%3A%20${encodeURIComponent(payload.phone)}`
    const { subject, html } = renderEmail('subscription-expiring-7-days', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      phone: payload.phone,
      cta_html: buildRenewalCta(payload.paymentLink, mailtoHref),
    })
    await sendMail({ to: payload.toEmail, subject, html })
  }

  async sendSubscriptionExpiring1DayEmail(payload: SubscriptionExpiringEmailPayload): Promise<void> {
    const mailtoHref = `mailto:support@finskool21.com?subject=Urgent%20renewal%20-%20${encodeURIComponent(payload.communityName)}&amp;body=Registered%20number%3A%20${encodeURIComponent(payload.phone)}`
    const { subject, html } = renderEmail('subscription-expiring-1-day', {
      first_name: firstNameOf(payload.name),
      community_name: payload.communityName,
      valid_till: formatEmailDate(payload.validTill),
      phone: payload.phone,
      cta_html: buildRenewalCta(payload.paymentLink, mailtoHref),
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
