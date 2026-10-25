import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../../src/lib/prisma.js'
import { env } from '../../src/config/env.js'
import { hashSessionId } from '../../src/lib/mobile-session.js'
import type { JwtPayload } from '../../src/middlewares/auth.middleware.js'
import type { UserStatus } from '../../src/generated/prisma/client.js'

export { prisma }

// Low bcrypt cost — the hash is only ever compared in-process during tests.
const TEST_BCRYPT_ROUNDS = 4

let seq = 0
const next = () => ++seq

/** A fresh, valid Indian mobile number in E.164 — the format normalizePhone() stores. */
export function nextMobile(): string {
  return `+9198${String(70_000_000 + next()).padStart(8, '0')}`
}

/** `YYYY-MM-DD`, `days` from today. Keep offsets well away from 0 to stay clear of TZ edges. */
export function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  if (tables.length === 0) return
  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

// ─── Admins (web dashboard users — JWT auth) ────────────────────────────────

export interface TestAdmin {
  id: string
  /** Value for the `Authorization` header. */
  auth: string
}

export async function createAdmin(
  opts: { isSuperAdmin?: boolean; communityIds?: string[]; name?: string; email?: string; password?: string } = {},
): Promise<TestAdmin> {
  const n = next()
  const isSuperAdmin = opts.isSuperAdmin ?? true
  const admin = await prisma.user.create({
    data: {
      name: opts.name ?? `Admin ${n}`,
      phone: nextMobile(),
      email: opts.email ?? `admin${n}@finskool.test`,
      passwordHash: opts.password ? await bcrypt.hash(opts.password, TEST_BCRYPT_ROUNDS) : null,
      role: 'admin',
      isSuperAdmin,
    },
  })
  for (const communityId of opts.communityIds ?? []) {
    await prisma.communityAdmin.create({ data: { adminId: admin.id, communityId } })
  }

  const payload: JwtPayload = {
    sub: admin.id,
    role: 'admin',
    type: 'access',
    communityIds: [],
    selectedCommunityId: null,
    accessibleCommunityIds: isSuperAdmin ? null : (opts.communityIds ?? []),
    isSuperAdmin,
  }
  return { id: admin.id, auth: `Bearer ${jwt.sign(payload, env.jwt.secret, { expiresIn: '15m' })}` }
}

// ─── Communities ────────────────────────────────────────────────────────────

export async function createCommunity(createdBy: string, opts: { name?: string; isFree?: boolean } = {}) {
  const n = next()
  const name = opts.name ?? `Community ${n}`
  return prisma.community.create({
    data: { name, slug: `community-${n}`, createdBy, isFree: opts.isFree ?? false },
  })
}

// ─── Members (mobile app users — MobileSession cookie auth) ─────────────────

export interface SubscriptionSpec {
  communityId: string
  validUntil: string
  payment?: number
  /** `null` = no paid-on date on record (some bulk imports), so revenue falls back to createdAt. */
  paidOn?: string | null
  isActive?: boolean
  createdAt?: Date
}

export interface MobileMemberSpec {
  name?: string
  phone?: string
  /** `null` = no email on file (allowed for admin-added members). */
  email?: string | null
  /** `null` = never completed mobile registration (no password set yet). */
  password?: string | null
  status?: UserStatus
  suspensionReason?: string
  /** 'admin' = added from the dashboard (has an ApprovedPhone row); 'self' = signed up in the app. */
  source?: 'admin' | 'self'
  subscriptions?: SubscriptionSpec[]
  /** When the account was created. Defaults to now (database clock). */
  createdAt?: Date
  /** Give the member a live MobileSession, as if they're logged into the app. Default true when registered. */
  loggedIn?: boolean
}

export interface TestMobileMember {
  id: string
  name: string
  phone: string
  email: string | null
  password: string | null
  /** Raw `mobile_session_id` cookie value, or null if not logged in. */
  sessionId: string | null
  subscriptionIds: string[]
}

export async function createMobileMember(spec: MobileMemberSpec = {}): Promise<TestMobileMember> {
  const n = next()
  const name = spec.name ?? `Member ${n}`
  const phone = spec.phone ?? nextMobile()
  const email = spec.email === undefined ? `member${n}@finskool.test` : spec.email
  const password = spec.password === undefined ? 'mobile-pass-123' : spec.password
  const source = spec.source ?? 'admin'

  const user = await prisma.user.create({
    data: {
      name,
      phone,
      email,
      passwordHash: password ? await bcrypt.hash(password, TEST_BCRYPT_ROUNDS) : null,
      status: spec.status ?? 'active',
      suspensionReason: spec.suspensionReason ?? null,
      ...(spec.createdAt ? { createdAt: spec.createdAt } : {}),
    },
  })

  if (source === 'admin') {
    await prisma.approvedPhone.create({
      data: { phone, name, email, status: password ? 'registered' : 'pending' },
    })
  }

  const subscriptionIds: string[] = []
  for (const s of spec.subscriptions ?? []) {
    const sub = await prisma.subscription.create({
      data: {
        userId: user.id,
        communityId: s.communityId,
        payment: s.payment ?? 999,
        paidOn: s.paidOn === null ? null : new Date(s.paidOn ?? daysFromNow(-10)),
        validUntil: new Date(s.validUntil),
        isActive: s.isActive ?? true,
        ...(s.createdAt ? { createdAt: s.createdAt } : {}),
      },
    })
    subscriptionIds.push(sub.id)
  }

  let sessionId: string | null = null
  if (spec.loggedIn ?? password !== null) {
    sessionId = randomBytes(32).toString('hex')
    const communityIds = (spec.subscriptions ?? []).map(s => s.communityId)
    await prisma.mobileSession.create({
      data: {
        userId: user.id,
        sessionIdHash: hashSessionId(sessionId),
        deviceType: n % 2 === 0 ? 'ios' : 'android',
        deviceName: 'Test Phone',
        communityIds,
        selectedCommunityId: communityIds.length === 1 ? communityIds[0]! : null,
        accessibleCommunityIds: [],
      },
    })
  }

  return { id: user.id, name, phone, email, password, sessionId, subscriptionIds }
}

/** Cookie header the mobile app sends on every authenticated request. */
export function mobileCookie(member: TestMobileMember): string {
  if (!member.sessionId) throw new Error(`${member.name} has no mobile session`)
  return `mobile_session_id=${member.sessionId}`
}

// ─── Support tickets & service enquiries ────────────────────────────────────

export async function createTicket(opts: {
  userId: string
  communityId: string
  status?: 'open' | 'in_progress' | 'resolved'
  subject?: string
  lastMessageAt?: Date
  /** An admin who has replied — leaves a message from them on the ticket. */
  repliedBy?: string
}) {
  const n = next()
  const ticket = await prisma.ticket.create({
    data: {
      userId: opts.userId,
      communityId: opts.communityId,
      category: 'other',
      type: 'question',
      subject: opts.subject ?? `Ticket subject ${n}`,
      description: 'Needs help',
      status: opts.status ?? 'open',
      clientRequestId: `req-${n}`,
      ...(opts.lastMessageAt ? { lastMessageAt: opts.lastMessageAt } : {}),
    },
  })
  await prisma.ticketMessage.create({
    data: { ticketId: ticket.id, senderId: opts.userId, senderRole: 'user', body: 'Hello', clientMessageId: `m-${n}-u` },
  })
  if (opts.repliedBy) {
    await prisma.ticketMessage.create({
      data: { ticketId: ticket.id, senderId: opts.repliedBy, senderRole: 'admin', body: 'On it', clientMessageId: `m-${n}-a` },
    })
  }
  return ticket
}

export async function createService(createdBy: string, title = 'Portfolio Review') {
  const n = next()
  return prisma.service.create({ data: { name: `service-${n}`, title, description: 'A service', createdBy } })
}

/**
 * A member can have only one open request per service (a partial unique index), so unless a
 * `serviceId` is given, each request gets its own service — titled `title`.
 */
export async function createServiceRequest(opts: {
  userId: string
  serviceId?: string
  title?: string
  status?: 'requested' | 'quote_sent' | 'paid' | 'closed'
  lastMessageAt?: Date
  repliedBy?: string
}) {
  const n = next()
  const serviceId = opts.serviceId ?? (await createService(opts.repliedBy ?? opts.userId, opts.title)).id
  const request = await prisma.serviceRequest.create({
    data: {
      userId: opts.userId,
      serviceId,
      needs: 'Please help',
      status: opts.status ?? 'requested',
      clientRequestId: `sr-${n}`,
      ...(opts.lastMessageAt ? { lastMessageAt: opts.lastMessageAt } : {}),
    },
  })
  await prisma.serviceMessage.create({
    data: { requestId: request.id, senderId: opts.userId, senderRole: 'user', body: 'Hi', clientMessageId: `sm-${n}-u` },
  })
  if (opts.repliedBy) {
    await prisma.serviceMessage.create({
      data: { requestId: request.id, senderId: opts.repliedBy, senderRole: 'admin', body: 'Sure', clientMessageId: `sm-${n}-a` },
    })
  }
  return request
}

/** A paid service request's invoice — the dashboard's source of service revenue. */
export async function createServiceInvoice(opts: {
  requestId: string
  userId: string
  adminId: string
  total: number
  issuedAt: Date
}) {
  const n = next()
  const quote = await prisma.serviceQuote.create({
    data: {
      requestId: opts.requestId,
      version: 1,
      baseAmount: opts.total,
      gstRatePercent: 0,
      gstAmount: 0,
      totalAmount: opts.total,
      expiresAt: new Date('2030-01-01'),
      status: 'paid',
      createdBy: opts.adminId,
    },
  })
  const order = await prisma.razorpayOrder.create({
    data: {
      razorpayOrderId: `order_${n}`,
      purpose: 'service_quote',
      referenceId: quote.id,
      userId: opts.userId,
      amount: opts.total,
      status: 'paid',
    },
  })
  const payment = await prisma.razorpayPayment.create({
    data: { razorpayPaymentId: `pay_${n}`, orderId: order.id, amount: opts.total, status: 'captured' },
  })
  return prisma.serviceInvoice.create({
    data: {
      requestId: opts.requestId,
      quoteId: quote.id,
      paymentId: payment.id,
      number: `INV-${n}`,
      financialYear: '2026-2027',
      sequence: n,
      issuedAt: opts.issuedAt,
      seller: {},
      buyer: {},
      description: 'Service',
      sacCode: '998313',
      taxableValue: opts.total,
      gstRatePercent: 0,
      total: opts.total,
    },
  })
}
