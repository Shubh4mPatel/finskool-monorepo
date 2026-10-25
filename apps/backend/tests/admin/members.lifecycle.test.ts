import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import bcrypt from 'bcryptjs'
import { createApp } from '../../src/app.js'
import {
  notificationsQueue,
  WELCOME_EMAIL_JOB,
  MEMBER_SUSPENDED_EMAIL_JOB,
  MEMBER_REINSTATED_EMAIL_JOB,
} from '../../src/lib/queue.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  mobileCookie,
  nextMobile,
  daysFromNow,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// Admin-side account lifecycle for members. Every member is a mobile app user:
// phone-keyed, logs in from the app with email + password, and authenticates
// each request with a MobileSession cookie. So beyond the DB writes, each admin
// action is checked against what the mobile app actually experiences afterwards.

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)

let superAdmin: TestAdmin
let paidCommunity: { id: string; name: string }
let freeCommunity: { id: string }

/** Any mobile-session-gated endpoint works as a probe; this one has no other preconditions. */
function mobileProbe(member: TestMobileMember) {
  return request(app).get('/api/v1/mobile/communities').set('Cookie', mobileCookie(member))
}

function mobileLogin(email: string, password: string) {
  return request(app)
    .post('/api/v1/auth/mobile/login')
    .set('User-Agent', 'Finskool/1.0 (Android 14; Pixel 8)')
    .send({ email, password, deviceType: 'android', deviceId: 'device-under-test' })
}

function jobsNamed(name: string) {
  return queueAdd.mock.calls.filter(([jobName]) => jobName === name).map(([, payload]) => payload)
}

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  superAdmin = await createAdmin({ isSuperAdmin: true })
  paidCommunity = await createCommunity(superAdmin.id, { name: 'Swing Traders' })
  freeCommunity = await createCommunity(superAdmin.id, { name: 'Finskool Free', isFree: true })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('admin member routes — access control', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/admin/members')
    expect(res.status).toBe(401)
  })

  it('rejects a logged-in mobile member trying to reach the admin API', async () => {
    const member = await createMobileMember({
      subscriptions: [{ communityId: paidCommunity.id, validUntil: daysFromNow(30) }],
    })

    const list = await request(app).get('/api/v1/admin/members').set('Cookie', mobileCookie(member))
    expect(list.status).toBe(403)

    // Nor can they act on their own (or anyone's) account.
    const suspend = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/revoke`)
      .set('Cookie', mobileCookie(member))
    expect(suspend.status).toBe(403)
  })

  it('rejects a forged/invalid admin token', async () => {
    const res = await request(app).get('/api/v1/admin/members').set('Authorization', 'Bearer not-a-real-token')
    expect(res.status).toBe(401)
  })
})

describe('POST /admin/members — add a mobile member', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    phone: '98765 43210',
    name: 'Priya Sharma',
    email: 'Priya.Sharma@Example.com',
    communityId: paidCommunity.id,
    payment: 4999,
    validUntil: daysFromNow(90),
    ...overrides,
  })

  it('pre-approves the phone so the person can finish signing up in the app', async () => {
    const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body())

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      phone: '+919876543210',
      name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      communityId: paidCommunity.id,
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919876543210' } })
    expect(user).toMatchObject({ role: 'member', status: 'active', passwordHash: null })

    const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: '+919876543210' } })
    expect(ap).toMatchObject({ status: 'pending', addedBy: superAdmin.id })
    expect(res.body.data.approvedPhoneId).toBe(ap.id)

    // Paid community from the form + the free tier every member gets.
    const subs = await prisma.subscription.findMany({ where: { userId: user.id } })
    expect(subs.map(s => s.communityId).sort()).toEqual([paidCommunity.id, freeCommunity.id].sort())
    expect(Number(subs.find(s => s.communityId === paidCommunity.id)!.payment)).toBe(4999)

    expect(jobsNamed(WELCOME_EMAIL_JOB)).toEqual([
      expect.objectContaining({ toEmail: 'priya.sharma@example.com', phone: '+919876543210', communityName: 'Swing Traders' }),
    ])
  })

  it('does not let the pre-approved member log into the app before they set a password', async () => {
    await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body())

    const login = await mobileLogin('priya.sharma@example.com', 'anything')
    expect(login.status).toBe(401)
    expect(login.body.code).toBe('NOT_REGISTERED')
  })

  it('allows adding a member with no email on file, and sends no email', async () => {
    const res = await request(app)
      .post('/api/v1/admin/members')
      .set('Authorization', superAdmin.auth)
      .send(body({ email: '' }))

    expect(res.status).toBe(201)
    expect(res.body.data.email).toBeNull()
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it.each([
    ['a landline-length number', '12345'],
    ['letters', 'not-a-phone'],
  ])('rejects an invalid mobile number (%s)', async (_label, phone) => {
    const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body({ phone }))
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Invalid phone number')
  })

  it.each([
    ['name too short', { name: 'P' }, 'Name must be at least 2 characters'],
    ['bad email', { email: 'nope' }, 'Invalid email address'],
    ['non-positive payment', { payment: 0 }, 'Payment must be a positive number'],
    ['bad validUntil', { validUntil: '31/12/2026' }, 'Valid until must be YYYY-MM-DD'],
    ['bad community id', { communityId: 'abc' }, 'Invalid community'],
  ])('validates the form: %s', async (_label, overrides, message) => {
    const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body(overrides))
    expect(res.status).toBe(400)
    expect(res.body.message).toBe(message)
  })

  it('rejects a phone already used by an active mobile member, whatever format it is typed in', async () => {
    await createMobileMember({ phone: '+919876543210' })

    for (const phone of ['9876543210', '+91 98765 43210', '098765-43210']) {
      const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body({ phone }))
      expect(res.status, phone).toBe(409)
      expect(res.body.code).toBe('PHONE_EXISTS')
    }
  })

  it.each(['suspended', 'deleted'] as const)(
    'asks for explicit confirmation before reusing a %s member\'s phone',
    async status => {
      await createMobileMember({ phone: '+919876543210', name: 'Old Owner', status })

      const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body())
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('MEMBER_REVIVE_REQUIRED')
      expect(res.body.message).toContain('Old Owner')

      const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919876543210' } })
      expect(user.status).toBe(status)
    },
  )

  it('rejects an email already registered to a different mobile member', async () => {
    await createMobileMember({ email: 'priya.sharma@example.com' })

    const res = await request(app).post('/api/v1/admin/members').set('Authorization', superAdmin.auth).send(body())
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('EMAIL_EXISTS')
  })

  it('returns 404 for an unknown community', async () => {
    const res = await request(app)
      .post('/api/v1/admin/members')
      .set('Authorization', superAdmin.auth)
      .send(body({ communityId: '00000000-0000-4000-8000-000000000000' }))
    expect(res.status).toBe(404)
  })

  it('stops a community-scoped admin from adding members to a community they do not manage', async () => {
    const other = await createCommunity(superAdmin.id)
    const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [other.id] })

    const denied = await request(app).post('/api/v1/admin/members').set('Authorization', scoped.auth).send(body())
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('COMMUNITY_ACCESS_DENIED')

    const allowed = await request(app)
      .post('/api/v1/admin/members')
      .set('Authorization', scoped.auth)
      .send(body({ communityId: other.id }))
    expect(allowed.status).toBe(201)
  })
})

describe('POST /admin/members/revive — reactivate a suspended/deleted mobile member', () => {
  const body = (phone: string, overrides: Record<string, unknown> = {}) => ({
    phone,
    name: 'Rahul Verma',
    email: 'rahul.v@example.com',
    communityId: paidCommunity.id,
    payment: 2999,
    validUntil: daysFromNow(60),
    ...overrides,
  })

  it('keeps a previously registered member\'s app password so they can log straight back in', async () => {
    const member = await createMobileMember({
      status: 'deleted',
      password: 'my-old-app-password',
      email: 'rahul.v@example.com',
      subscriptions: [{ communityId: paidCommunity.id, validUntil: daysFromNow(-5), isActive: false }],
    })
    const before = await mobileLogin('rahul.v@example.com', 'my-old-app-password')
    expect(before.status).toBe(401)

    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send(body(member.phone))
    expect(res.status).toBe(201)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user).toMatchObject({ status: 'active', suspensionReason: null, name: 'Rahul Verma' })
    expect(await bcrypt.compare('my-old-app-password', user.passwordHash!)).toBe(true)

    const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: member.phone } })
    expect(ap.status).toBe('registered')

    expect(jobsNamed(MEMBER_REINSTATED_EMAIL_JOB)).toHaveLength(1)
    expect(jobsNamed(WELCOME_EMAIL_JOB)).toHaveLength(0)

    const after = await mobileLogin('rahul.v@example.com', 'my-old-app-password')
    expect(after.status).toBe(200)
  })

  it('creates an ApprovedPhone for a self-registered member who is revived', async () => {
    const member = await createMobileMember({ status: 'suspended', source: 'self', email: 'rahul.v@example.com' })

    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send(body(member.phone))
    expect(res.status).toBe(201)

    const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: member.phone } })
    expect(ap).toMatchObject({ status: 'registered', addedBy: superAdmin.id })
  })

  it('treats a member who never finished app sign-up as pending and sends a welcome email', async () => {
    const member = await createMobileMember({ status: 'suspended', password: null, email: null })

    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send(body(member.phone))
    expect(res.status).toBe(201)

    const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: member.phone } })
    expect(ap.status).toBe('pending')
    expect(jobsNamed(WELCOME_EMAIL_JOB)).toEqual([expect.objectContaining({ toEmail: 'rahul.v@example.com' })])
  })

  it('returns 404 when there is nobody to revive', async () => {
    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send(body(nextMobile()))
    expect(res.status).toBe(404)
  })

  it('refuses to "revive" a member who is already active', async () => {
    const member = await createMobileMember()
    const res = await request(app)
      .post('/api/v1/admin/members/revive')
      .set('Authorization', superAdmin.auth)
      .send(body(member.phone))
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('PHONE_EXISTS')
  })
})

describe('PATCH /admin/members/:id/suspend and /revoke', () => {
  let member: TestMobileMember

  beforeEach(async () => {
    member = await createMobileMember({
      name: 'Anita Rao',
      email: 'anita@example.com',
      subscriptions: [{ communityId: paidCommunity.id, validUntil: daysFromNow(30) }],
    })
  })

  it('suspending kicks the member out of the app immediately and blocks re-login', async () => {
    expect((await mobileProbe(member)).status).toBe(200)

    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: '  Sharing paid content outside the group  ' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      userId: member.id,
      isActive: false,
      suspensionReason: 'Sharing paid content outside the group',
    })

    const probe = await mobileProbe(member)
    expect(probe.status).toBe(401)
    expect(probe.body.code).toBe('SESSION_INVALIDATED')

    expect((await mobileLogin('anita@example.com', member.password!)).status).toBe(401)

    expect(jobsNamed(MEMBER_SUSPENDED_EMAIL_JOB)).toEqual([
      { toEmail: 'anita@example.com', name: 'Anita Rao', reason: 'Sharing paid content outside the group' },
    ])

    // Suspension doesn't touch subscriptions — they're still there on reinstatement.
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: member.subscriptionIds[0]! } })
    expect(sub.isActive).toBe(true)
  })

  it('requires a reason', async () => {
    for (const reason of [undefined, '', '   ']) {
      const res = await request(app)
        .patch(`/api/v1/admin/members/${member.id}/suspend`)
        .set('Authorization', superAdmin.auth)
        .send({ reason })
      expect(res.status).toBe(400)
    }
    const tooLong = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'x'.repeat(1001) })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.message).toBe('Reason is too long')
  })

  it('cannot suspend an admin account or a deleted member', async () => {
    const otherAdmin = await createAdmin()
    const adminRes = await request(app)
      .patch(`/api/v1/admin/members/${otherAdmin.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'x' })
    expect(adminRes.status).toBe(403)

    const deleted = await createMobileMember({ status: 'deleted' })
    const deletedRes = await request(app)
      .patch(`/api/v1/admin/members/${deleted.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'x' })
    expect(deletedRes.status).toBe(409)
  })

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/members/00000000-0000-4000-8000-000000000000/suspend')
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'x' })
    expect(res.status).toBe(404)
  })

  it('revoking a suspension restores app access without forcing a new login', async () => {
    await request(app)
      .patch(`/api/v1/admin/members/${member.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'Payment dispute' })
    queueAdd.mockClear()

    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/revoke`)
      .set('Authorization', superAdmin.auth)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ userId: member.id, isActive: true })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user).toMatchObject({ status: 'active', suspensionReason: null })

    // The app's existing session cookie works again, and so does a fresh login.
    expect((await mobileProbe(member)).status).toBe(200)
    expect((await mobileLogin('anita@example.com', member.password!)).status).toBe(200)

    expect(jobsNamed(MEMBER_REINSTATED_EMAIL_JOB)).toEqual([{ toEmail: 'anita@example.com', name: 'Anita Rao' }])
  })

  it('does not email a member who has no email on file', async () => {
    const noEmail = await createMobileMember({ email: null })
    await request(app)
      .patch(`/api/v1/admin/members/${noEmail.id}/suspend`)
      .set('Authorization', superAdmin.auth)
      .send({ reason: 'x' })
    await request(app).patch(`/api/v1/admin/members/${noEmail.id}/revoke`).set('Authorization', superAdmin.auth)
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('cannot revoke a deletion or touch an admin account through /revoke', async () => {
    const deleted = await createMobileMember({ status: 'deleted' })
    const deletedRes = await request(app)
      .patch(`/api/v1/admin/members/${deleted.id}/revoke`)
      .set('Authorization', superAdmin.auth)
    expect(deletedRes.status).toBe(409)

    const otherAdmin = await createAdmin()
    const adminRes = await request(app)
      .patch(`/api/v1/admin/members/${otherAdmin.id}/revoke`)
      .set('Authorization', superAdmin.auth)
    expect(adminRes.status).toBe(404)
  })
})

describe('DELETE /admin/members/:id', () => {
  it('soft-deletes the member, ends every subscription, and logs them out of the app', async () => {
    const member = await createMobileMember({
      email: 'del@example.com',
      subscriptions: [
        { communityId: paidCommunity.id, validUntil: daysFromNow(30) },
        { communityId: freeCommunity.id, validUntil: daysFromNow(3650), payment: 0 },
      ],
    })

    const res = await request(app).delete(`/api/v1/admin/members/${member.id}`).set('Authorization', superAdmin.auth)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ userId: member.id, phone: member.phone, isActive: false })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user.status).toBe('deleted')
    const active = await prisma.subscription.count({ where: { userId: member.id, isActive: true } })
    expect(active).toBe(0)

    // Admin-side record of the phone is kept so the admin can revive later.
    expect(await prisma.approvedPhone.findUnique({ where: { phone: member.phone } })).not.toBeNull()

    expect((await mobileProbe(member)).status).toBe(401)
    expect((await mobileLogin('del@example.com', member.password!)).status).toBe(401)
  })

  it('refuses to delete an admin account', async () => {
    const otherAdmin = await createAdmin()
    const res = await request(app).delete(`/api/v1/admin/members/${otherAdmin.id}`).set('Authorization', superAdmin.auth)
    expect(res.status).toBe(403)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })
    expect(user.status).toBe('active')
  })

  it('returns 404 for an unknown member', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/members/00000000-0000-4000-8000-000000000000')
      .set('Authorization', superAdmin.auth)
    expect(res.status).toBe(404)
  })
})

describe('POST /admin/members/bulk-delete', () => {
  it('deletes what it can and reports the rest per id', async () => {
    const a = await createMobileMember()
    const b = await createMobileMember()
    const keep = await createMobileMember()
    const otherAdmin = await createAdmin()
    const ghost = '00000000-0000-4000-8000-000000000000'

    const res = await request(app)
      .post('/api/v1/admin/members/bulk-delete')
      .set('Authorization', superAdmin.auth)
      .send({ userIds: [a.id, otherAdmin.id, b.id, ghost] })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ total: 4, succeeded: 2, failed: 2 })
    expect(res.body.data.errors).toEqual([
      { userId: otherAdmin.id, reason: expect.stringContaining('Admin') },
      { userId: ghost, reason: 'Member not found' },
    ])

    const statuses = await prisma.user.findMany({
      where: { id: { in: [a.id, b.id, keep.id] } },
      select: { id: true, status: true },
    })
    expect(Object.fromEntries(statuses.map(s => [s.id, s.status]))).toEqual({
      [a.id]: 'deleted',
      [b.id]: 'deleted',
      [keep.id]: 'active',
    })
    expect((await mobileProbe(a)).status).toBe(401)
    expect((await mobileProbe(keep)).status).toBe(200)
  })

  it.each([
    ['empty list', { userIds: [] }],
    ['non-uuid id', { userIds: ['abc'] }],
    ['missing body', {}],
  ])('validates the payload: %s', async (_label, payload) => {
    const res = await request(app)
      .post('/api/v1/admin/members/bulk-delete')
      .set('Authorization', superAdmin.auth)
      .send(payload)
    expect(res.status).toBe(400)
  })
})
