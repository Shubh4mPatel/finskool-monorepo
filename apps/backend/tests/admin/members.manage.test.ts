import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import redis from '../../src/lib/redis.js'
import {
  notificationsQueue,
  NOTIFICATIONS_PUBSUB_CHANNEL,
  COMMUNITY_ADDED_EMAIL_JOB,
  COMMUNITY_ACCESS_REMOVED_EMAIL_JOB,
  SUBSCRIPTION_EXTENDED_EMAIL_JOB,
} from '../../src/lib/queue.js'
import { NotificationType } from '../../src/modules/notifications/notifications.dto.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  mobileCookie,
  daysFromNow,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// Admin-side roster management for mobile members: listing/filtering/export,
// viewing and editing a member, password resets, and per-community access.
// No free community is seeded here on purpose, so a member whose paid access
// has lapsed is genuinely locked out of the mobile app (SUBSCRIPTION_EXPIRED).

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)
const redisPublish = vi.mocked(redis.publish)

let superAdmin: TestAdmin
let swing: { id: string; name: string }
let options: { id: string; name: string }

function mobileProbe(member: TestMobileMember) {
  return request(app).get('/api/v1/mobile/communities').set('Cookie', mobileCookie(member))
}

function mobileLogin(email: string, password: string) {
  return request(app)
    .post('/api/v1/auth/mobile/login')
    .set('User-Agent', 'Finskool/1.0 (iPhone; iOS 18.1)')
    .send({ email, password, deviceType: 'ios' })
}

function listMembers(admin: TestAdmin, query: Record<string, string | number> = {}) {
  return request(app).get('/api/v1/admin/members').query(query).set('Authorization', admin.auth)
}

function jobsNamed(name: string) {
  return queueAdd.mock.calls.filter(([jobName]) => jobName === name).map(([, payload]) => payload)
}

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  redisPublish.mockClear()
  superAdmin = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(superAdmin.id, { name: 'Swing Traders' })
  options = await createCommunity(superAdmin.id, { name: 'Options Lab' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /admin/members — roster', () => {
  it('lists only mobile members (never admins), alphabetically, with pagination', async () => {
    await createAdmin() // must not appear
    for (const name of ['Zara Khan', 'Aarav Mehta', 'Meera Iyer', 'Dev Patel', 'Kabir Singh']) {
      await createMobileMember({ name, subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
    }

    const page1 = await listMembers(superAdmin, { page: 1, pageSize: 2 })
    expect(page1.status).toBe(200)
    expect(page1.body.data).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3 })
    expect(page1.body.data.members.map((m: { name: string }) => m.name)).toEqual(['Aarav Mehta', 'Dev Patel'])

    const page3 = await listMembers(superAdmin, { page: 3, pageSize: 2 })
    expect(page3.body.data.members.map((m: { name: string }) => m.name)).toEqual(['Zara Khan'])
  })

  it('defaults to 8 per page and rejects out-of-range paging', async () => {
    const res = await listMembers(superAdmin)
    expect(res.body.data.pageSize).toBe(8)

    expect((await listMembers(superAdmin, { pageSize: 101 })).status).toBe(400)
    expect((await listMembers(superAdmin, { page: 0 })).status).toBe(400)
    expect((await listMembers(superAdmin, { accountStatus: 'banned' })).status).toBe(400)
    expect((await listMembers(superAdmin, { communityId: 'not-a-uuid' })).status).toBe(400)
  })

  it('shows each member\'s source, registration and account status, and current subscription', async () => {
    const adminAdded = await createMobileMember({
      name: 'A Admin-added',
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30), payment: 4999, paidOn: daysFromNow(-20) }],
    })
    await createMobileMember({ name: 'B Pending', password: null })
    await createMobileMember({ name: 'C Self-signup', source: 'self' })
    await createMobileMember({ name: 'D Suspended', status: 'suspended', suspensionReason: 'Chargeback' })

    const res = await listMembers(superAdmin, { pageSize: 100 })
    const byName = Object.fromEntries(res.body.data.members.map((m: { name: string }) => [m.name, m]))

    expect(byName['A Admin-added']).toMatchObject({
      id: adminAdded.id,
      phone: adminAdded.phone,
      source: 'admin',
      registrationStatus: 'registered',
      accountStatus: 'active',
      hasActiveSubscription: true,
      suspensionReason: null,
      subscription: {
        communityId: swing.id,
        communityName: 'Swing Traders',
        payment: 4999,
        paidOn: daysFromNow(-20),
        validUntil: daysFromNow(30),
        isActive: true,
      },
    })
    expect(byName['B Pending']).toMatchObject({ source: 'admin', registrationStatus: 'pending', subscription: null })
    expect(byName['C Self-signup']).toMatchObject({ source: 'self', registrationStatus: null, approvedPhoneId: null })
    expect(byName['D Suspended']).toMatchObject({ accountStatus: 'suspended', suspensionReason: 'Chargeback' })
  })

  it('shows the admin\'s record of name/email over what the member typed in the app', async () => {
    const member = await createMobileMember({ name: 'Rohit (app)', email: 'rohit.app@example.com' })
    await prisma.approvedPhone.update({
      where: { phone: member.phone },
      data: { name: 'Rohit Kumar', email: 'rohit@example.com' },
    })

    const res = await listMembers(superAdmin)
    expect(res.body.data.members[0]).toMatchObject({ name: 'Rohit Kumar', email: 'rohit@example.com' })
  })

  it('reports only the latest subscription per community after renewals', async () => {
    await createMobileMember({
      name: 'Renewed',
      subscriptions: [
        { communityId: swing.id, validUntil: daysFromNow(-30), isActive: false, payment: 1000, createdAt: new Date(Date.now() - 90 * 864e5) },
        { communityId: swing.id, validUntil: daysFromNow(60), payment: 2000, createdAt: new Date(Date.now() - 30 * 864e5) },
        { communityId: options.id, validUntil: daysFromNow(10), payment: 500, createdAt: new Date(Date.now() - 5 * 864e5) },
      ],
    })

    const [m] = (await listMembers(superAdmin)).body.data.members
    expect(m.allSubscriptions).toHaveLength(2)
    expect(m.allSubscriptions.find((s: { communityId: string }) => s.communityId === swing.id).payment).toBe(2000)
    // Most recently created current row is the headline subscription.
    expect(m.subscription).toMatchObject({ communityId: options.id, payment: 500 })
  })

  describe('filters', () => {
    let active: TestMobileMember
    let expired: TestMobileMember
    let noSubs: TestMobileMember
    let expiringSoon: TestMobileMember
    let suspended: TestMobileMember
    let selfSignup: TestMobileMember
    let pending: TestMobileMember

    const idsOf = (res: request.Response) => res.body.data.members.map((m: { id: string }) => m.id).sort()

    beforeEach(async () => {
      active = await createMobileMember({
        name: 'Active Ananya', email: 'ananya@example.com', phone: '+919811100001',
        subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60), paidOn: daysFromNow(-40) }],
      })
      expired = await createMobileMember({
        name: 'Expired Ishaan',
        subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-10), isActive: false, paidOn: daysFromNow(-100) }],
      })
      noSubs = await createMobileMember({ name: 'NoSubs Neha' })
      expiringSoon = await createMobileMember({
        name: 'Soon Sahil',
        subscriptions: [{ communityId: options.id, validUntil: daysFromNow(3) }],
      })
      suspended = await createMobileMember({
        name: 'Suspended Sara', status: 'suspended',
        subscriptions: [{ communityId: options.id, validUntil: daysFromNow(60) }],
      })
      selfSignup = await createMobileMember({ name: 'Self Siddharth', source: 'self' })
      pending = await createMobileMember({ name: 'Pending Pooja', password: null })
    })

    it('accountStatus', async () => {
      expect(idsOf(await listMembers(superAdmin, { accountStatus: 'suspended' }))).toEqual([suspended.id])
    })

    it('communityId', async () => {
      expect(idsOf(await listMembers(superAdmin, { communityId: options.id }))).toEqual(
        [expiringSoon.id, suspended.id].sort(),
      )
    })

    it('hasActiveSubscription=true / false', async () => {
      expect(idsOf(await listMembers(superAdmin, { hasActiveSubscription: 'true', pageSize: 100 }))).toEqual(
        [active.id, expiringSoon.id, suspended.id].sort(),
      )
      expect(idsOf(await listMembers(superAdmin, { hasActiveSubscription: 'false', pageSize: 100 }))).toEqual(
        [expired.id, noSubs.id, selfSignup.id, pending.id].sort(),
      )
    })

    it('expiringIn7Days', async () => {
      expect(idsOf(await listMembers(superAdmin, { expiringIn7Days: 'true' }))).toEqual([expiringSoon.id])
    })

    it('source and registrationStatus', async () => {
      expect(idsOf(await listMembers(superAdmin, { source: 'self' }))).toEqual([selfSignup.id])
      expect(idsOf(await listMembers(superAdmin, { registrationStatus: 'pending' }))).toEqual([pending.id])
      // Impossible combination ANDs down to nothing rather than one filter winning.
      expect(idsOf(await listMembers(superAdmin, { source: 'self', registrationStatus: 'pending' }))).toEqual([])
    })

    it('validFrom/validTo and paidFrom/paidTo date ranges', async () => {
      expect(
        idsOf(await listMembers(superAdmin, { validFrom: daysFromNow(50), validTo: daysFromNow(70), pageSize: 100 })),
      ).toEqual([active.id, suspended.id].sort())
      expect(idsOf(await listMembers(superAdmin, { paidTo: daysFromNow(-50) }))).toEqual([expired.id])
    })

    it.each([
      ['partial phone digits', '98111'],
      ['name, case-insensitive', 'aNaNyA'],
      ['email fragment', 'ananya@'],
    ])('search by %s', async (_label, search) => {
      expect(idsOf(await listMembers(superAdmin, { search }))).toEqual([active.id])
    })

    it('combines filters with AND', async () => {
      expect(
        idsOf(await listMembers(superAdmin, { communityId: options.id, accountStatus: 'active' })),
      ).toEqual([expiringSoon.id])
    })
  })

  describe('community-scoped admin', () => {
    it('only sees members of the communities they manage', async () => {
      const inSwing = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      await createMobileMember({ subscriptions: [{ communityId: options.id, validUntil: daysFromNow(30) }] })
      await createMobileMember() // no community at all
      const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })

      const res = await listMembers(scoped)
      expect(res.body.data.members.map((m: { id: string }) => m.id)).toEqual([inSwing.id])

      const explicit = await listMembers(scoped, { communityId: swing.id })
      expect(explicit.body.data.total).toBe(1)
    })

    it('is refused when filtering by a community they do not manage', async () => {
      const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
      const res = await listMembers(scoped, { communityId: options.id })
      expect(res.status).toBe(403)
      expect(res.body.code).toBe('COMMUNITY_ACCESS_DENIED')
    })

    it('sees nobody when they manage no communities', async () => {
      await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [] })
      expect((await listMembers(scoped)).body.data.total).toBe(0)
    })
  })
})

describe('GET /admin/members/export', () => {
  it('downloads a CSV with one row per subscription and human-readable statuses', async () => {
    await createMobileMember({
      name: 'Asha "Ace" Nair', phone: '+919811100002', email: 'asha@example.com',
      subscriptions: [
        { communityId: swing.id, validUntil: '2030-03-31', paidOn: '2026-01-15', payment: 12500 },
        { communityId: options.id, validUntil: '2030-01-31', paidOn: '2026-01-10', payment: 999 },
      ],
    })
    await createMobileMember({ name: 'Bhavesh Pending', password: null, email: null })
    await createMobileMember({ name: 'Chitra Suspended', status: 'suspended' })
    await createMobileMember({
      name: 'Dinesh Expired',
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-10), isActive: false }],
    })

    const res = await request(app).get('/api/v1/admin/members/export').set('Authorization', superAdmin.auth)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="members-export-\d{4}-\d{2}-\d{2}\.csv"$/)
    expect(res.text.startsWith('﻿')).toBe(true) // Excel needs the BOM for ₹ to render

    const lines = res.text.slice(1).split('\n')
    expect(lines[0]).toBe('"Name","Phone","Email","Community","Payment","Paid On","Valid Till","Status","Added On"')
    expect(lines).toHaveLength(1 + 5)

    const asha = lines.filter(l => l.startsWith('"Asha'))
    expect(asha).toHaveLength(2)
    expect(asha.find(l => l.includes('Swing Traders'))).toContain(
      '"Asha ""Ace"" Nair","+919811100002","asha@example.com","Swing Traders","₹12,500","15 Jan 2026","31 Mar 2030","Registered"',
    )
    expect(lines.find(l => l.startsWith('"Bhavesh'))).toContain('"","—","—","—","—","Pending Sign"')
    expect(lines.find(l => l.startsWith('"Chitra'))).toContain('"Suspended"')
    expect(lines.find(l => l.startsWith('"Dinesh'))).toContain('"Expired"')
  })

  it('applies the same filters as the roster', async () => {
    await createMobileMember({ name: 'Keep', status: 'suspended' })
    await createMobileMember({ name: 'Drop' })

    const res = await request(app)
      .get('/api/v1/admin/members/export')
      .query({ accountStatus: 'suspended' })
      .set('Authorization', superAdmin.auth)
    const lines = res.text.slice(1).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/^"Keep"/)
  })

  it('is not scoped to a scoped admin\'s communities (product decision)', async () => {
    await createMobileMember({ subscriptions: [{ communityId: options.id, validUntil: daysFromNow(30) }] })
    const scoped = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })

    const res = await request(app).get('/api/v1/admin/members/export').set('Authorization', scoped.auth)
    expect(res.status).toBe(200)
    expect(res.text.slice(1).split('\n')).toHaveLength(2)
  })
})

describe('GET /admin/members/:id', () => {
  it('returns the member profile with every current subscription', async () => {
    const member = await createMobileMember({
      name: 'Farhan Ali',
      subscriptions: [
        { communityId: swing.id, validUntil: daysFromNow(-30), isActive: false, createdAt: new Date(Date.now() - 60 * 864e5) },
        { communityId: swing.id, validUntil: daysFromNow(30), createdAt: new Date(Date.now() - 1 * 864e5) },
      ],
    })

    const res = await request(app).get(`/api/v1/admin/members/${member.id}`).set('Authorization', superAdmin.auth)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id: member.id,
      name: 'Farhan Ali',
      phone: member.phone,
      hasActiveSubscription: true,
      subscription: { communityId: swing.id, validUntil: daysFromNow(30) },
    })
    expect(res.body.data.allSubscriptions).toHaveLength(1)
  })

  it('returns 404 for an admin account or an unknown id', async () => {
    const otherAdmin = await createAdmin()
    for (const id of [otherAdmin.id, '00000000-0000-4000-8000-000000000000']) {
      const res = await request(app).get(`/api/v1/admin/members/${id}`).set('Authorization', superAdmin.auth)
      expect(res.status).toBe(404)
    }
  })
})

describe('PATCH /admin/members/:id — edit a member', () => {
  it('updates name, phone and email everywhere, and the member logs into the app with the new email', async () => {
    const member = await createMobileMember({ name: 'Old Name', email: 'old@example.com', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })

    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: 'New Name', phone: '91234 56789', email: 'New@Example.com' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ name: 'New Name', phone: '+919123456789', email: 'new@example.com' })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user).toMatchObject({ name: 'New Name', phone: '+919123456789', email: 'new@example.com' })
    const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: '+919123456789' } })
    expect(ap).toMatchObject({ name: 'New Name', email: 'new@example.com' })
    expect(await prisma.approvedPhone.findUnique({ where: { phone: member.phone } })).toBeNull()

    expect((await mobileLogin('old@example.com', member.password!)).status).toBe(401)
    expect((await mobileLogin('new@example.com', member.password!)).status).toBe(200)
  })

  it('allows saving the form unchanged (no self-conflict on phone/email)', async () => {
    const member = await createMobileMember({ name: 'Same', email: 'same@example.com' })
    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: 'Same', phone: member.phone, email: 'same@example.com' })
    expect(res.status).toBe(200)
  })

  it('clears the email when the field is emptied', async () => {
    const member = await createMobileMember({ email: 'gone@example.com' })
    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: member.name, phone: member.phone, email: '' })
    expect(res.status).toBe(200)
    expect(res.body.data.email).toBeNull()
  })

  it('rejects a phone or email that belongs to another mobile member', async () => {
    const member = await createMobileMember()
    const other = await createMobileMember({ phone: '+919800000099', email: 'taken@example.com', source: 'self' })

    const phoneRes = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: member.name, phone: '098000 00099' })
    expect(phoneRes.status).toBe(409)
    expect(phoneRes.body.code).toBe('PHONE_EXISTS')

    const emailRes = await request(app)
      .patch(`/api/v1/admin/members/${member.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: member.name, phone: member.phone, email: 'TAKEN@example.com' })
    expect(emailRes.status).toBe(409)
    expect(emailRes.body.code).toBe('EMAIL_EXISTS')

    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: other.id } })
    expect(untouched.phone).toBe('+919800000099')
  })

  it('validates the form', async () => {
    const member = await createMobileMember()
    const cases = [
      [{ name: 'X', phone: member.phone }, 'Name must be at least 2 characters'],
      [{ name: 'Valid', phone: '' }, 'Phone is required'],
      [{ name: 'Valid', phone: '123' }, 'Invalid phone number'],
    ] as const
    for (const [payload, message] of cases) {
      const res = await request(app).patch(`/api/v1/admin/members/${member.id}`).set('Authorization', superAdmin.auth).send(payload)
      expect(res.status).toBe(400)
      expect(res.body.message).toBe(message)
    }
  })

  it('cannot edit an admin account', async () => {
    const otherAdmin = await createAdmin()
    const res = await request(app)
      .patch(`/api/v1/admin/members/${otherAdmin.id}`)
      .set('Authorization', superAdmin.auth)
      .send({ name: 'Hacked', phone: '9876543210' })
    expect(res.status).toBe(404)
  })

  describe('adding the member to another community', () => {
    it('grants access, notifies the app in real time, and adopts a self-signup into the admin roster', async () => {
      const member = await createMobileMember({ name: 'Gauri', email: 'gauri@example.com', source: 'self' })

      const res = await request(app)
        .patch(`/api/v1/admin/members/${member.id}`)
        .set('Authorization', superAdmin.auth)
        .send({
          name: 'Gauri',
          phone: member.phone,
          email: 'gauri@example.com',
          newCommunity: { communityId: options.id, payment: 1999, validUntil: daysFromNow(180) },
        })

      expect(res.status).toBe(200)
      expect(res.body.data).toMatchObject({
        source: 'admin',
        registrationStatus: 'registered',
        hasActiveSubscription: true,
        subscription: { communityId: options.id, payment: 1999, validUntil: daysFromNow(180) },
      })

      const ap = await prisma.approvedPhone.findUniqueOrThrow({ where: { phone: member.phone } })
      expect(ap).toMatchObject({ status: 'registered', addedBy: superAdmin.id })

      const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: member.id, communityId: options.id } })
      const inApp = await prisma.notification.findFirstOrThrow({ where: { userId: member.id } })
      expect(inApp).toMatchObject({
        type: NotificationType.CommunityAdded,
        communityId: options.id,
        sourceId: sub.id,
        title: "You've been added to Options Lab",
      })

      expect(redisPublish).toHaveBeenCalledTimes(1)
      const [channel, payload] = redisPublish.mock.calls[0]!
      expect(channel).toBe(NOTIFICATIONS_PUBSUB_CHANNEL)
      expect(JSON.parse(payload as string)).toMatchObject({
        userId: member.id,
        type: NotificationType.CommunityAdded,
        communityId: options.id,
        sourceId: sub.id,
      })

      expect(jobsNamed(COMMUNITY_ADDED_EMAIL_JOB)).toEqual([
        expect.objectContaining({ toEmail: 'gauri@example.com', communityName: 'Options Lab' }),
      ])
    })

    it('refuses a community the member is already active in', async () => {
      const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      const res = await request(app)
        .patch(`/api/v1/admin/members/${member.id}`)
        .set('Authorization', superAdmin.auth)
        .send({
          name: member.name,
          phone: member.phone,
          newCommunity: { communityId: swing.id, payment: 100, validUntil: daysFromNow(60) },
        })
      expect(res.status).toBe(409)
      expect(res.body.code).toBe('ALREADY_IN_COMMUNITY')
    })

    it('refuses a deleted community', async () => {
      const member = await createMobileMember()
      await prisma.community.update({ where: { id: options.id }, data: { deletedAt: new Date() } })
      const res = await request(app)
        .patch(`/api/v1/admin/members/${member.id}`)
        .set('Authorization', superAdmin.auth)
        .send({
          name: member.name,
          phone: member.phone,
          newCommunity: { communityId: options.id, payment: 100, validUntil: daysFromNow(60) },
        })
      expect(res.status).toBe(404)
    })

    it('does not write anything when the edit is rejected', async () => {
      const member = await createMobileMember({ name: 'Before', subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }] })
      await request(app)
        .patch(`/api/v1/admin/members/${member.id}`)
        .set('Authorization', superAdmin.auth)
        .send({
          name: 'After',
          phone: member.phone,
          newCommunity: { communityId: swing.id, payment: 100, validUntil: daysFromNow(60) },
        })
      const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
      expect(user.name).toBe('Before')
      expect(await prisma.subscription.count({ where: { userId: member.id } })).toBe(1)
    })
  })
})

describe('PATCH /admin/members/:id/password', () => {
  it('sets a new app password: the new one works, the old one stops working', async () => {
    const member = await createMobileMember({
      email: 'reset@example.com',
      password: 'forgotten-pass',
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(30) }],
    })

    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/password`)
      .set('Authorization', superAdmin.auth)
      .send({ newPassword: 'Brand-New-1' })
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(member.id)
    expect(JSON.stringify(res.body)).not.toContain('passwordHash')

    expect((await mobileLogin('reset@example.com', 'forgotten-pass')).status).toBe(401)
    const login = await mobileLogin('reset@example.com', 'Brand-New-1')
    expect(login.status).toBe(200)
    expect(login.headers['set-cookie']?.[0]).toMatch(/^mobile_session_id=/)
  })

  it('requires at least 8 characters', async () => {
    const member = await createMobileMember()
    const res = await request(app)
      .patch(`/api/v1/admin/members/${member.id}/password`)
      .set('Authorization', superAdmin.auth)
      .send({ newPassword: 'short' })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Password must be at least 8 characters')
  })

  it('cannot reset an admin\'s password through the member endpoint', async () => {
    const otherAdmin = await createAdmin()
    const res = await request(app)
      .patch(`/api/v1/admin/members/${otherAdmin.id}/password`)
      .set('Authorization', superAdmin.auth)
      .send({ newPassword: 'takeover-123' })
    expect(res.status).toBe(404)
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: otherAdmin.id } })
    expect(admin.passwordHash).toBeNull()
  })
})

describe('DELETE /admin/members/:id/communities/:communityId', () => {
  it('removes one community but leaves the member\'s app account working', async () => {
    const member = await createMobileMember({
      email: 'two@example.com',
      subscriptions: [
        { communityId: swing.id, validUntil: daysFromNow(30) },
        { communityId: options.id, validUntil: daysFromNow(30) },
      ],
    })

    const res = await request(app)
      .delete(`/api/v1/admin/members/${member.id}/communities/${swing.id}`)
      .set('Authorization', superAdmin.auth)
    expect(res.status).toBe(200)

    const subs = await prisma.subscription.findMany({ where: { userId: member.id }, orderBy: { communityId: 'asc' } })
    expect(Object.fromEntries(subs.map(s => [s.communityId, s.isActive]))).toEqual({ [swing.id]: false, [options.id]: true })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: member.id } })
    expect(user.status).toBe('active')
    expect((await mobileProbe(member)).status).toBe(200)

    expect(jobsNamed(COMMUNITY_ACCESS_REMOVED_EMAIL_JOB)).toEqual([
      expect.objectContaining({ toEmail: 'two@example.com', communityName: 'Swing Traders' }),
    ])
  })

  it('returns 404 when the member has no active subscription there', async () => {
    const member = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-5), isActive: false }],
    })
    for (const communityId of [swing.id, options.id]) {
      const res = await request(app)
        .delete(`/api/v1/admin/members/${member.id}/communities/${communityId}`)
        .set('Authorization', superAdmin.auth)
      expect(res.status).toBe(404)
    }
  })
})

describe('POST /admin/subscriptions/:id/extend', () => {
  it('renews a lapsed member, who can then log back into the app', async () => {
    const member = await createMobileMember({
      email: 'lapsed@example.com',
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-3), isActive: false, payment: 999 }],
    })
    const blocked = await mobileLogin('lapsed@example.com', member.password!)
    expect(blocked.status).toBe(401)
    expect(blocked.body.code).toBe('SUBSCRIPTION_EXPIRED')

    const res = await request(app)
      .post(`/api/v1/admin/subscriptions/${member.subscriptionIds[0]}/extend`)
      .set('Authorization', superAdmin.auth)
      .send({ validUntil: daysFromNow(365), payment: 9999 })
    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      userId: member.id,
      communityId: swing.id,
      payment: 9999,
      validUntil: daysFromNow(365),
      isActive: true,
    })

    const subs = await prisma.subscription.findMany({ where: { userId: member.id }, orderBy: { createdAt: 'asc' } })
    expect(subs.map(s => s.isActive)).toEqual([false, true]) // old period kept as history

    const inApp = await prisma.notification.findFirstOrThrow({ where: { userId: member.id } })
    expect(inApp).toMatchObject({ type: NotificationType.SubscriptionExtended, sourceId: res.body.data.id })
    expect(redisPublish).toHaveBeenCalledWith(NOTIFICATIONS_PUBSUB_CHANNEL, expect.stringContaining(member.id))
    expect(jobsNamed(SUBSCRIPTION_EXTENDED_EMAIL_JOB)).toEqual([
      expect.objectContaining({ toEmail: 'lapsed@example.com', amount: 9999 }),
    ])

    expect((await mobileLogin('lapsed@example.com', member.password!)).status).toBe(200)
  })

  it('rejects an end date on or before the paid-on date', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(5) }] })
    const res = await request(app)
      .post(`/api/v1/admin/subscriptions/${member.subscriptionIds[0]}/extend`)
      .set('Authorization', superAdmin.auth)
      .send({ validUntil: '2026-01-01', paidOn: '2026-01-01', payment: 100 })
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown subscription', async () => {
    const res = await request(app)
      .post('/api/v1/admin/subscriptions/00000000-0000-4000-8000-000000000000/extend')
      .set('Authorization', superAdmin.auth)
      .send({ validUntil: daysFromNow(30), payment: 100 })
    expect(res.status).toBe(404)
  })
})
