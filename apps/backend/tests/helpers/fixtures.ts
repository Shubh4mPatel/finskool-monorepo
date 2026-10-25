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
  opts: { isSuperAdmin?: boolean; communityIds?: string[] } = {},
): Promise<TestAdmin> {
  const n = next()
  const isSuperAdmin = opts.isSuperAdmin ?? true
  const admin = await prisma.user.create({
    data: {
      name: `Admin ${n}`,
      phone: nextMobile(),
      email: `admin${n}@finskool.test`,
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
  paidOn?: string
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
        paidOn: new Date(s.paidOn ?? daysFromNow(-10)),
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
