import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import redis from '../../src/lib/redis.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  daysFromNow,
  type TestAdmin,
} from '../helpers/fixtures.js'

// The website is the admin console. Members use the mobile app, so signing in here — or keeping a web
// session alive, or registering — is refused with a pointer to the app, whatever their credentials.

const app = createApp()
const redisGet = vi.mocked(redis.get)

const ADMIN_EMAIL = 'boss@finskool.test'
const ADMIN_PASSWORD = 'correct-horse-1'
const MEMBER_EMAIL = 'member@finskool.test'
const MEMBER_PASSWORD = 'mobile-pass-123' // the fixture's default

const login = (email: string, password: string) => request(app).post('/api/v1/auth/login').send({ email, password })
const cookieNames = (res: request.Response): string[] =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).map(c => c.split('=')[0]!)

let admin: TestAdmin
let community: { id: string }

beforeEach(async () => {
  await resetDb()
  redisGet.mockReset()
  redisGet.mockResolvedValue(null)
  admin = await createAdmin({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  community = await createCommunity(admin.id, { name: 'Swing Traders' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /auth/login', () => {
  it('lets an admin in and sets the session cookies', async () => {
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

    expect(res.status).toBe(200)
    expect(res.body.data.user).toMatchObject({ id: admin.id, role: 'admin' })
    expect(cookieNames(res)).toEqual(expect.arrayContaining(['access_token', 'refresh_token']))
  })

  it('tells a member to use the mobile app — even with the right password and an active subscription', async () => {
    await createMobileMember({
      email: MEMBER_EMAIL,
      subscriptions: [{ communityId: community.id, validUntil: daysFromNow(30) }],
    })

    const res = await login(MEMBER_EMAIL, MEMBER_PASSWORD)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ADMIN_ONLY')
    expect(res.body.message).toMatch(/mobile app/i)
    expect(cookieNames(res)).toEqual([]) // no session of any kind
  })

  it('gives a member whose subscription has lapsed the same answer, not "subscription expired"', async () => {
    await createMobileMember({
      email: MEMBER_EMAIL,
      subscriptions: [{ communityId: community.id, validUntil: daysFromNow(-5), isActive: false }],
    })

    const res = await login(MEMBER_EMAIL, MEMBER_PASSWORD)
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ADMIN_ONLY')
  })

  it('does not reveal that an email belongs to a member when the password is wrong', async () => {
    await createMobileMember({ email: MEMBER_EMAIL })

    const wrong = await login(MEMBER_EMAIL, 'not-the-password')
    const unknown = await login('nobody@finskool.test', 'whatever-123')

    expect(wrong.status).toBe(401)
    expect(wrong.body.code).toBeUndefined()
    expect(wrong.body.message).toBe('Invalid email or password')
    expect(unknown.status).toBe(401)
    expect(unknown.body.message).toBe(wrong.body.message)
  })

  it('refuses an admin with the wrong password', async () => {
    const res = await login(ADMIN_EMAIL, 'wrong-password')
    expect(res.status).toBe(401)
    expect(cookieNames(res)).toEqual([])
  })

  it('refuses a deactivated admin', async () => {
    await prisma.user.update({ where: { id: admin.id }, data: { status: 'suspended' } })
    const res = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
    expect(res.status).toBe(401)
  })

  it('points a member who has not registered yet at the mobile app, not at a sign-up page', async () => {
    await createMobileMember({ email: MEMBER_EMAIL, password: null })

    const res = await login(MEMBER_EMAIL, 'anything-at-all')

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('NOT_REGISTERED')
    expect(res.body.message).toMatch(/mobile app/i)
  })
})

describe('POST /auth/register (web sign-up)', () => {
  it('is closed — and sets no password on a pending member\'s account', async () => {
    const pending = await createMobileMember({ password: null, email: null })

    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Someone Else',
      phone: pending.phone,
      email: 'attacker@example.com',
      password: 'hijack-pass-123',
      confirmPassword: 'hijack-pass-123',
    })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('MOBILE_ONLY')
    expect(cookieNames(res)).toEqual([])

    const user = await prisma.user.findUniqueOrThrow({ where: { id: pending.id } })
    expect(user.passwordHash).toBeNull()
    expect(user.email).toBeNull()
  })
})

describe('GET /auth/refresh', () => {
  const refreshTokenFor = (userId: string) => jwt.sign({ sub: userId, type: 'refresh' }, env.jwt.secret)
  const refresh = (token: string) => request(app).get('/api/v1/auth/refresh').set('Cookie', `refresh_token=${token}`)

  it('keeps an admin\'s session alive', async () => {
    redisGet.mockResolvedValueOnce(admin.id) // the stored refresh token maps to this admin

    const res = await refresh(refreshTokenFor(admin.id))

    expect(res.status).toBe(200)
    expect(cookieNames(res)).toContain('access_token')
  })

  it('ends a member\'s old web session: it can no longer be refreshed', async () => {
    const member = await createMobileMember({ email: MEMBER_EMAIL })
    redisGet.mockResolvedValueOnce(member.id)

    const res = await refresh(refreshTokenFor(member.id))

    expect(res.status).toBe(401)
    expect(res.body.code).toBe('ADMIN_ONLY')
    expect(cookieNames(res)).toEqual([])
  })
})
