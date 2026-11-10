import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { env } from '../config/env.js'

export const NOTIFICATIONS_QUEUE_NAME = 'notifications'
export const COMMUNITY_POST_JOB = 'community-post'

// Separate from the notifications queue: this is a ~20-minute sweep over every
// active stock (rate-limited to Finedge's 300 req/min), so it shouldn't
// compete with time-sensitive notification jobs for worker concurrency slots.
export const STOCK_CLOSE_PRICE_QUEUE_NAME = 'stock-close-price'
export const REFRESH_CLOSE_PRICES_JOB = 'refresh-close-prices'

// Also separate from the other two queues: houses cron.ts's own periodic
// digest/lifecycle jobs (subscription expiry reminders, admin digests). These
// are scheduler-driven (upsertJobScheduler), not triggered by API requests —
// cron.ts is both the sole producer (registers the schedulers) and sole
// consumer (runs the Worker) of this queue, unlike NOTIFICATIONS_QUEUE_NAME
// which the API process produces and worker.ts consumes.
export const DIGEST_QUEUE_NAME = 'digest'
export const SUBSCRIPTION_LIFECYCLE_SWEEP_JOB = 'subscription-lifecycle-sweep'
export const EXPIRE_SUBSCRIPTIONS_JOB = 'expire-subscriptions'
export const TICKET_UPLOAD_CLEANUP_JOB = 'ticket-upload-cleanup'
export const SERVICE_QUOTE_EXPIRY_JOB = 'service-quote-expiry'
export const PUSH_TOKEN_CLEANUP_JOB = 'push-token-cleanup'
export const NOTIFICATION_CLEANUP_JOB = 'notification-cleanup'
export const PUSH_RETRY_JOB = 'push-retry'

export interface CommunityPostNotificationJobPayload {
  communityId: string
  postId: string
  message: string
  triggeredByUserId: string
  postTitle: string
  postExcerpt: string
}

export const WELCOME_EMAIL_JOB = 'welcome-email'

export interface WelcomeEmailJobPayload {
  toEmail: string
  name: string
  phone: string
  communityName: string
  validTill: string
}

export const SUBSCRIPTION_EXTENDED_EMAIL_JOB = 'subscription-extended-email'

export interface SubscriptionExtendedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  validTill: string
  amount: number
  paidOn: string
  /** The payment receipt to attach as a PDF (set when the member paid online). */
  receiptId?: string
}

export const SERVICE_INVOICE_EMAIL_JOB = 'service-invoice-email'

export interface ServiceInvoiceEmailJobPayload {
  toEmail: string
  name: string
  invoiceId: string
}

export const COMMUNITY_ADDED_EMAIL_JOB = 'community-added-email'

export interface CommunityAddedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  validTill: string
  /** The payment receipt to attach as a PDF (set when the member paid online). */
  receiptId?: string
}

export const COMMUNITY_ACCESS_REMOVED_EMAIL_JOB = 'community-access-removed-email'

export interface CommunityAccessRemovedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
}

// An admin blocked / unblocked the member in ONE community (their account and other communities are untouched).
export const COMMUNITY_BLOCKED_EMAIL_JOB = 'community-blocked-email'

export interface CommunityBlockedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  reason: string
}

export const COMMUNITY_UNBLOCKED_EMAIL_JOB = 'community-unblocked-email'

export interface CommunityUnblockedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
}

// An admin moved the end date of the member's running plan in one community earlier.
export const SUBSCRIPTION_REDUCED_EMAIL_JOB = 'subscription-reduced-email'

export interface SubscriptionReducedEmailJobPayload {
  toEmail: string
  name: string
  communityName: string
  /** ISO. The new end date. */
  validTill: string
  /** ISO. The end date it had before. */
  previousValidTill: string
}

export const NEW_MEMBER_REGISTERED_EMAIL_JOB = 'new-member-registered-email'

export interface NewMemberRegisteredEmailJobPayload {
  adminEmail: string
  adminName: string
  memberName: string
  phone: string
  communityName: string
  registeredDate: string
}

export const ADMIN_PAYMENT_EMAIL_JOB = 'admin-payment-email'

/** Tells one admin that a member paid (a plan or a service), or that a service payment needs a look. */
export interface AdminPaymentEmailJobPayload {
  adminEmail: string
  adminName: string
  /** `paid`: a normal payment. `review`: the money came in but could not be applied, so an admin has to step in. */
  kind: 'paid' | 'review'
  memberName: string
  /** What was bought, ready to print: "Swing Alpha · 3 Months (renewal)" or "Portfolio Review (SR-12)". */
  item: string
  /** The amount, ready to print: "₹4,999". */
  amount: string
  paidOn: string // ISO string
  /** Page on the website the button opens, e.g. /admin/members/<id>. */
  path: string
}

export const MEMBER_SUSPENDED_EMAIL_JOB = 'member-suspended-email'

export interface MemberSuspendedEmailJobPayload {
  toEmail: string
  name: string
  reason: string
}

// An admin reset the member's password: the email carries the new password so they can sign in and change it.
// Queued with removeOnFail: true (see admin.service.ts) so the password never lingers in Redis after the last attempt.
export const MEMBER_PASSWORD_RESET_EMAIL_JOB = 'member-password-reset-email'

export interface MemberPasswordResetEmailJobPayload {
  toEmail: string
  name: string
  newPassword: string
}

export const MEMBER_REINSTATED_EMAIL_JOB = 'member-reinstated-email'

export interface MemberReinstatedEmailJobPayload {
  toEmail: string
  name: string
}

export const OTP_EMAIL_JOB = 'otp-email'

export interface OtpEmailJobPayload {
  toEmail: string
  name: string
  otp: string
  expiryMinutes: number
}

export const OTP_WHATSAPP_JOB = 'otp-whatsapp'

export interface OtpWhatsappJobPayload {
  phone: string   // E.164, with leading '+' (lib/phone.ts's normalizePhone output)
  otp: string
  // Only used by the WHATSAPP_EMAIL_FALLBACK_ENABLED fallback — the OTP is emailed here if WhatsApp delivery fails.
  email?: string
  name?: string
  expiryMinutes?: number
}

export const PASSWORD_RESET_OTP_EMAIL_JOB = 'password-reset-otp-email'

export interface PasswordResetOtpEmailJobPayload {
  toEmail: string
  name: string
  otp: string
  expiryMinutes: number
}

export const PUSH_NOTIFICATION_JOB = 'push-notification'

export interface PushNotificationJobPayload {
  userIds: string[]
  title: string
  body: string
  // Routing info for the app, e.g. { type: 'ticket', id: '...' }; values are stringified at send time.
  data: Record<string, string>
  threadId?: string
}

export const MOBILE_NEW_LOGIN_EMAIL_JOB = 'mobile-new-login-email'

export interface MobileNewLoginEmailJobPayload {
  toEmail: string
  name: string
  deviceName: string
  // Where the app said the login came from; absent when it did not say.
  location?: string
  loginAt: string // ISO string
}

export type NotificationJobPayload =
  | CommunityPostNotificationJobPayload
  | WelcomeEmailJobPayload
  | SubscriptionExtendedEmailJobPayload
  | SubscriptionReducedEmailJobPayload
  | ServiceInvoiceEmailJobPayload
  | CommunityAddedEmailJobPayload
  | CommunityAccessRemovedEmailJobPayload
  | CommunityBlockedEmailJobPayload
  | CommunityUnblockedEmailJobPayload
  | NewMemberRegisteredEmailJobPayload
  | AdminPaymentEmailJobPayload
  | MemberSuspendedEmailJobPayload
  | MemberPasswordResetEmailJobPayload
  | MemberReinstatedEmailJobPayload
  | OtpEmailJobPayload
  | OtpWhatsappJobPayload
  | PasswordResetOtpEmailJobPayload
  | MobileNewLoginEmailJobPayload
  | PushNotificationJobPayload

// Published by NotificationsService (running in the worker process) whenever a
// new notification row is created, and consumed by lib/live-notifications-feed.ts
// (running in the API process) to push it to the recipient's open tabs over
// WebSocket immediately instead of waiting for the client's next poll.
export const NOTIFICATIONS_PUBSUB_CHANNEL = 'notifications:live'

export interface LiveNotificationEvent {
  userId: string
  type: string
  communityId: string | null
  message: string
  sourceId: string
  // Set for comment-related events ('thread', 'new-member-reply',
  // 'thread-resolved') so the frontend can target the specific post's open
  // PostThreads instance instead of blindly refetching every open thread.
  postId?: string
}

// Published by the tickets services (API process) and consumed by
// lib/live-tickets-feed.ts to push ticket activity to the right users' open
// sockets. `userIds` is the already-resolved audience; it is stripped before
// the event is forwarded to clients.
export const TICKETS_PUBSUB_CHANNEL = 'tickets:live'

export type LiveTicketEventName = 'ticket.created' | 'ticket.message' | 'ticket.updated' | 'ticket.read'

export interface LiveTicketEvent {
  userIds: string[]
  event: LiveTicketEventName
  ticketId: string
  communityId: string
  data: unknown
}

// Service-request activity travels over the same Redis channel and the same /ws/tickets socket,
// so the app keeps a single connection. `service.*` names keep the two feeds apart for clients.
export type LiveServiceEventName = 'service.created' | 'service.message' | 'service.updated' | 'service.read'

export interface LiveServiceEvent {
  userIds: string[]
  event: LiveServiceEventName
  requestId: string
  data: unknown
}

// BullMQ requires maxRetriesPerRequest: null on any Redis connection it manages —
// a different tuning than lib/redis.ts's client (used for refresh tokens/caching).
// Passed as plain options (not a shared ioredis.Redis instance) so BullMQ builds
// its own connection using its bundled ioredis types, and so the API process
// (this file) and the worker process each get an independent connection.
export function createBullConnection(): ConnectionOptions {
  return {
    host: env.redis.host,
    port: env.redis.port,
    password: env.redis.password || undefined,
    db: env.redis.db,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
}

export const notificationsQueue = new Queue<NotificationJobPayload, unknown, string>(
  NOTIFICATIONS_QUEUE_NAME,
  { connection: createBullConnection() },
)

export const stockClosePriceQueue = new Queue(
  STOCK_CLOSE_PRICE_QUEUE_NAME,
  { connection: createBullConnection() },
)

export const digestQueue = new Queue(
  DIGEST_QUEUE_NAME,
  { connection: createBullConnection() },
)
