import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash } from 'crypto'
import type { Redis } from 'ioredis'
import { createApp } from '../../src/app.js'
import { MobileAuthService } from '../../src/modules/mobile-auth/mobile-auth.service.js'
import { notificationsQueue, PASSWORD_RESET_OTP_EMAIL_JOB } from '../../src/lib/queue.js'
import { passwordResetOtpKey, passwordResetCypherKey } from '../../src/lib/redis.js'
import { logger } from '../../src/shared/logger.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, daysFromNow } from '../helpers/fixtures.js'

// Adversarial tests for the mobile forgot-password flow (mobile-auth.service.ts). The global Redis mock answers
// null to everything, so these use a small in-memory Redis that behaves like the real one, one command per tick.

function fakeRedis() {
  const store = new Map<string, string>()
  const tick = () => Promise.resolve()
  const redis = {
    get: async (k: string) => { await tick(); return store.get(k) ?? null },
    set: async (k: string, v: string) => { await tick(); store.set(k, v); return 'OK' },
    del: async (k: string) => { await tick(); return store.delete(k) ? 1 : 0 },
    ttl: async () => { await tick(); return 600 },
    incr: async () => 1,
    expire: async () => 1,
  }
  return { redis: redis as unknown as Redis, store }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function activeMember() {
  const admin = await createAdmin()
  const community = await createCommunity(admin.id)
  return createMobileMember({ subscriptions: [{ communityId: community.id, validUntil: daysFromNow(30) }] })
}

beforeEach(async () => {
  await resetDb()
  vi.mocked(notificationsQueue.add).mockClear()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('mobile forgot-password: adversarial', () => {
  // Attack: fire many guesses at once. The attempt counter is read, then written back, so every guess that starts
  // before the first write sees "0 attempts" and gets compared against the code. 5 attempts should mean 5.
  it('stops evaluating guesses after 5 wrong codes, even when they arrive at the same moment', async () => {
    const m = await activeMember()
    const { redis, store } = fakeRedis()
    store.set(passwordResetOtpKey(m.email!), JSON.stringify({ hash: sha256('123456'), attempts: 0 }))
    const service = new MobileAuthService(prisma, redis)

    const results = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => service.verifyResetOtp(m.email!, String(900_000 + i))))
    const evaluated = results.filter(r => r.status === 'rejected' && (r.reason as { code?: string }).code === 'OTP_INVALID').length

    expect(evaluated).toBeLessThanOrEqual(5)
  })

  // Attack: replay the reset cypher twice at once. The doc says single-use; get-then-del lets both through.
  it('lets a reset cypher change the password only once, even when it is redeemed twice at the same moment', async () => {
    const m = await activeMember()
    const { redis, store } = fakeRedis()
    const cypher = 'c'.repeat(64)
    store.set(passwordResetCypherKey(sha256(cypher)), m.id)
    const service = new MobileAuthService(prisma, redis)

    const results = await Promise.allSettled([service.resetPassword(cypher, 'first-new-password'), service.resetPassword(cypher, 'second-new-password')])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  })

  // Attack: someone already has a logged-in session on the account (the reason the owner is resetting the password).
  // Changing the password should end that session.
  it('logs out every existing mobile session when the password is reset', async () => {
    const m = await activeMember()
    expect(await prisma.mobileSession.count({ where: { userId: m.id } })).toBe(1)
    const { redis, store } = fakeRedis()
    const cypher = 'd'.repeat(64)
    store.set(passwordResetCypherKey(sha256(cypher)), m.id)

    await new MobileAuthService(prisma, redis).resetPassword(cypher, 'brand-new-password-1')

    expect(await prisma.mobileSession.count({ where: { userId: m.id } })).toBe(0)
  })

  // Attack: read the server logs. A code that resets someone's password must not be readable from them.
  it('never writes the reset code to the logs', async () => {
    const m = await activeMember()
    const { redis } = fakeRedis()
    const logged: string[] = []
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => { logged.push(JSON.stringify(args)) }) as never)
    }

    await new MobileAuthService(prisma, redis).forgotPassword(m.email!)

    const job = vi.mocked(notificationsQueue.add).mock.calls.find(c => c[0] === PASSWORD_RESET_OTP_EMAIL_JOB)?.[1] as { otp?: string } | undefined
    expect(job?.otp).toMatch(/^\d{6}$/)
    expect(logged.filter(line => line.includes(job!.otp!))).toEqual([])
    vi.restoreAllMocks()
  })
})

describe('mobile login: adversarial', () => {
  // Attack: guess the password. Every other password-guessable endpoint (web forgot/reset, social login) is rate
  // limited per IP; mobile login is not. 40 wrong passwords in a row should hit a 429 at some point.
  it('starts refusing with 429 after a burst of wrong passwords for one account', async () => {
    const m = await activeMember()
    const app = createApp()

    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      statuses.push((await request(app).post('/api/v1/auth/mobile/login').send({ email: m.email, password: `wrong-guess-${i}` })).status)
    }

    expect(statuses).toContain(429)
  })
})
