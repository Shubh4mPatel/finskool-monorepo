import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import redis from '../../src/lib/redis.js'
import { notificationsQueue, PASSWORD_RESET_OTP_EMAIL_JOB } from '../../src/lib/queue.js'
import { prisma, resetDb, createAdmin, createMobileMember } from '../helpers/fixtures.js'

// "Forgot password" on the admin console: emailed 6-digit code -> single-use cypher -> new password.
// Redis is a mock everywhere else in the suite; here it is a small in-memory fake, because the flow lives in it.

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)

const ADMIN_EMAIL = 'boss@finskool.test'
const OLD_PASSWORD = 'old-password-1'
const NEW_PASSWORD = 'brand-new-pass-2'
const GENERIC = /belongs to an admin account/i

let store: Map<string, string>

function installFakeRedis() {
  store = new Map()
  const r = vi.mocked(redis) as unknown as Record<string, ReturnType<typeof vi.fn>>
  r.get!.mockImplementation(async (k: string) => store.get(k) ?? null)
  r.set!.mockImplementation(async (k: string, v: string) => {
    store.set(k, v)
    return 'OK'
  })
  r.del!.mockImplementation(async (...keys: string[]) => keys.filter(k => store.delete(k)).length)
  r.ttl!.mockResolvedValue(300)
  r.incr!.mockImplementation(async (k: string) => {
    const n = Number(store.get(k) ?? 0) + 1
    store.set(k, String(n))
    return n
  })
  r.expire!.mockResolvedValue(1)
  r.mget!.mockImplementation(async (...keys: string[]) => keys.map(k => store.get(k) ?? null))
  r.scan!.mockImplementation(async (_cursor: string, _m: string, pattern: string) => {
    const prefix = pattern.replace(/\*$/, '')
    return ['0', [...store.keys()].filter(k => k.startsWith(prefix))]
  })
}

const forgot = (email: string, ip = '10.0.0.1') =>
  request(app).post('/api/v1/auth/forgot-password').set('X-Forwarded-For', ip).send({ email })
const verify = (email: string, otp: string) => request(app).post('/api/v1/auth/forgot-password/verify-otp').send({ email, otp })
const reset = (cypher: string, newPassword = NEW_PASSWORD, confirmNewPassword = newPassword) =>
  request(app).post('/api/v1/auth/forgot-password/reset').send({ cypher, newPassword, confirmNewPassword })
const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password })

/** The code the admin would read in their inbox: the one handed to the email job. */
function lastEmailedCode(): string {
  const call = [...queueAdd.mock.calls].reverse().find(c => c[0] === PASSWORD_RESET_OTP_EMAIL_JOB)
  if (!call) throw new Error('no reset email was queued')
  return (call[1] as { otp: string }).otp
}
const resetEmailsQueued = () => queueAdd.mock.calls.filter(c => c[0] === PASSWORD_RESET_OTP_EMAIL_JOB).length

/** Runs forgot -> verify and returns the cypher. */
async function verifiedCypher(): Promise<string> {
  await forgot(ADMIN_EMAIL)
  const res = await verify(ADMIN_EMAIL, lastEmailedCode())
  expect(res.status).toBe(200)
  return res.body.data.cypher as string
}

let adminId: string

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  installFakeRedis()
  adminId = (await createAdmin({ email: ADMIN_EMAIL, password: OLD_PASSWORD })).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /auth/forgot-password', () => {
  it('emails a 6-digit code to an active admin', async () => {
    const res = await forgot(ADMIN_EMAIL)

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(GENERIC)
    expect(resetEmailsQueued()).toBe(1)
    expect(lastEmailedCode()).toMatch(/^\d{6}$/)
    const job = queueAdd.mock.calls.find(c => c[0] === PASSWORD_RESET_OTP_EMAIL_JOB)![1] as { toEmail: string; expiryMinutes: number }
    expect(job).toMatchObject({ toEmail: ADMIN_EMAIL, expiryMinutes: 10 })
  })

  it('stores only a hash of the code', async () => {
    await forgot(ADMIN_EMAIL)
    const stored = [...store.entries()].find(([k]) => k.startsWith('admin:otp:reset:') && !k.includes('cooldown'))![1]
    expect(stored).not.toContain(lastEmailedCode())
  })

  it('gives the same answer, and sends nothing, for an unknown email', async () => {
    const known = await forgot(ADMIN_EMAIL)
    queueAdd.mockClear()

    const unknown = await forgot('nobody@finskool.test')

    expect(unknown.status).toBe(known.status)
    expect(unknown.body).toEqual(known.body)
    expect(resetEmailsQueued()).toBe(0)
  })

  it('sends nothing for a member: members reset from the mobile app', async () => {
    await createMobileMember({ email: 'member@finskool.test' })

    const res = await forgot('member@finskool.test')

    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(GENERIC)
    expect(resetEmailsQueued()).toBe(0)
  })

  it('sends nothing for a suspended admin', async () => {
    await prisma.user.update({ where: { id: adminId }, data: { status: 'suspended' } })
    await forgot(ADMIN_EMAIL)
    expect(resetEmailsQueued()).toBe(0)
  })

  it('sends one code per minute: a second request inside the cooldown is silently ignored', async () => {
    await forgot(ADMIN_EMAIL)
    const again = await forgot(ADMIN_EMAIL)

    expect(again.status).toBe(200)
    expect(resetEmailsQueued()).toBe(1)
  })

  it('rejects a malformed email', async () => {
    const res = await forgot('not-an-email')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('limits one address to 10 requests an hour', async () => {
    for (let i = 0; i < 10; i++) expect((await forgot(`probe${i}@finskool.test`, '10.9.9.9')).status).toBe(200)
    const blocked = await forgot('probe11@finskool.test', '10.9.9.9')
    expect(blocked.status).toBe(429)
  })
})

describe('POST /auth/forgot-password/verify-otp', () => {
  it('accepts the emailed code and hands back a cypher', async () => {
    await forgot(ADMIN_EMAIL)

    const res = await verify(ADMIN_EMAIL, lastEmailedCode())

    expect(res.status).toBe(200)
    expect(res.body.data.cypher).toMatch(/^[0-9a-f]{64}$/)
    expect(res.body.data.cypherExpiresInSeconds).toBe(600)
  })

  it('refuses a wrong code and a code that was never sent, with the same message', async () => {
    await forgot(ADMIN_EMAIL)
    const wrong = await verify(ADMIN_EMAIL, lastEmailedCode() === '000000' ? '111111' : '000000')
    const neverSent = await verify('nobody@finskool.test', '123456')

    expect(wrong.status).toBe(400)
    expect(wrong.body.code).toBe('OTP_INVALID')
    expect(neverSent.status).toBe(400)
    expect(neverSent.body).toMatchObject({ code: 'OTP_INVALID', message: wrong.body.message })
  })

  it('burns the code after five wrong guesses, even if the sixth try is right', async () => {
    await forgot(ADMIN_EMAIL)
    const right = lastEmailedCode()
    const wrong = right === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) expect((await verify(ADMIN_EMAIL, wrong)).status).toBe(400)

    const res = await verify(ADMIN_EMAIL, right)

    expect(res.status).toBe(429)
    expect(res.body.code).toBe('OTP_LOCKED')
    expect((await verify(ADMIN_EMAIL, right)).status).toBe(400) // and it is gone, not just paused
  })

  it('works once: the code cannot be used a second time', async () => {
    await forgot(ADMIN_EMAIL)
    const code = lastEmailedCode()
    expect((await verify(ADMIN_EMAIL, code)).status).toBe(200)
    expect((await verify(ADMIN_EMAIL, code)).status).toBe(400)
  })

  it('does not issue a cypher if the admin was suspended after the code was sent', async () => {
    await forgot(ADMIN_EMAIL)
    await prisma.user.update({ where: { id: adminId }, data: { status: 'suspended' } })

    const res = await verify(ADMIN_EMAIL, lastEmailedCode())

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('OTP_INVALID')
  })

  it('rejects a code that is not 6 digits', async () => {
    const res = await verify(ADMIN_EMAIL, '12ab')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
})

describe('POST /auth/forgot-password/reset', () => {
  it('sets the new password: it signs in, the old one no longer does', async () => {
    const cypher = await verifiedCypher()

    const res = await reset(cypher)

    expect(res.status).toBe(200)
    expect((await login(ADMIN_EMAIL, NEW_PASSWORD)).status).toBe(200)
    expect((await login(ADMIN_EMAIL, OLD_PASSWORD)).status).toBe(401)
  })

  it('ends the admin\'s existing web sessions and leaves everyone else\'s alone', async () => {
    const other = await createAdmin({ isSuperAdmin: false })
    store.set('refresh:laptop', adminId)
    store.set('refresh:phone-browser', adminId)
    store.set('refresh:someone-else', other.id)
    const cypher = await verifiedCypher()

    await reset(cypher)

    expect(store.has('refresh:laptop')).toBe(false)
    expect(store.has('refresh:phone-browser')).toBe(false)
    expect(store.get('refresh:someone-else')).toBe(other.id)
  })

  it('works once: the same cypher cannot reset the password again', async () => {
    const cypher = await verifiedCypher()
    expect((await reset(cypher)).status).toBe(200)

    const replay = await reset(cypher, 'another-pass-3')

    expect(replay.status).toBe(400)
    expect(replay.body.code).toBe('RESET_TOKEN_INVALID')
    expect((await login(ADMIN_EMAIL, NEW_PASSWORD)).status).toBe(200) // still the first new password
  })

  it('refuses a made-up cypher', async () => {
    const res = await reset('f'.repeat(64))
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESET_TOKEN_INVALID')
  })

  it('does not accept a cypher issued by the mobile forgot-password flow', async () => {
    const { createHash } = await import('node:crypto')
    const mobileCypher = 'a'.repeat(64)
    store.set(`reset_cypher:${createHash('sha256').update(mobileCypher).digest('hex')}`, adminId)

    const res = await reset(mobileCypher)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESET_TOKEN_INVALID')
    expect((await login(ADMIN_EMAIL, OLD_PASSWORD)).status).toBe(200)
  })

  it('refuses if the admin was suspended between verifying and resetting', async () => {
    const cypher = await verifiedCypher()
    await prisma.user.update({ where: { id: adminId }, data: { status: 'suspended' } })

    const res = await reset(cypher)

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('RESET_TOKEN_INVALID')
    const user = await prisma.user.findUniqueOrThrow({ where: { id: adminId } })
    expect(user.passwordHash).not.toBeNull()
    expect((await login(ADMIN_EMAIL, OLD_PASSWORD)).status).toBe(401) // suspended, but the password was not touched
  })

  it('rejects mismatched passwords and passwords under 8 characters, and keeps the cypher usable', async () => {
    const cypher = await verifiedCypher()

    const mismatch = await reset(cypher, NEW_PASSWORD, 'something-else-9')
    const short = await reset(cypher, 'short', 'short')
    expect(mismatch.status).toBeGreaterThanOrEqual(400)
    expect(mismatch.status).toBeLessThan(500)
    expect(short.status).toBeGreaterThanOrEqual(400)
    expect(short.status).toBeLessThan(500)

    expect((await reset(cypher)).status).toBe(200) // a typo does not cost the admin their verified code
  })
})
