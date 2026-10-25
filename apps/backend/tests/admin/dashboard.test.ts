import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  createTicket,
  createServiceRequest,
  createServiceInvoice,
  mobileCookie,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// The admin home screen: five independent endpoints under /api/v1/admin/dashboard.
// "Now" is pinned to Sun 25 Oct 2026, 13:30 IST so month windows ("1–25 Oct vs 1–25 Sep") and
// IST day boundaries are deterministic. Only Date is faked — sockets and timers stay real.

const app = createApp()
const NOW = new Date('2026-10-25T08:00:00Z')
const at = (iso: string) => new Date(iso)
const FAR = '2126-01-01'

let superAdmin: TestAdmin
let swing: { id: string; name: string }
let options: { id: string; name: string }
let free: { id: string }

const get = (admin: TestAdmin, path: string, query: Record<string, string | number> = {}) =>
  request(app).get(`/api/v1/admin/dashboard${path}`).query(query).set('Authorization', admin.auth)

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
})

beforeEach(async () => {
  vi.setSystemTime(NOW)
  await resetDb()
  superAdmin = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(superAdmin.id, { name: 'Swing Traders' })
  options = await createCommunity(superAdmin.id, { name: 'Options Lab' })
  free = await createCommunity(superAdmin.id, { name: 'Finskool Free', isFree: true })
})

afterAll(async () => {
  vi.useRealTimers()
  await prisma.$disconnect()
})

describe('access control', () => {
  const paths = ['/kpis', '/revenue', '/expiring', '/registrations', '/tickets']

  it.each(paths)('GET %s rejects unauthenticated requests', async path => {
    expect((await request(app).get(`/api/v1/admin/dashboard${path}`)).status).toBe(401)
  })

  it.each(paths)('GET %s rejects a logged-in mobile member', async path => {
    const member: TestMobileMember = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: '2026-12-01' }],
    })
    const res = await request(app).get(`/api/v1/admin/dashboard${path}`).set('Cookie', mobileCookie(member))
    expect(res.status).toBe(403)
  })
})

describe('shared dataset: KPIs and revenue', () => {
  let limited: TestAdmin

  beforeEach(async () => {
    // a: registered, active in Swing (₹1,000 on 12 Oct) + the free tier
    const a = await createMobileMember({
      name: 'Aarav Active', createdAt: at('2026-10-10T05:00:00Z'),
      subscriptions: [
        { communityId: swing.id, validUntil: '2026-12-01', payment: 1000, paidOn: '2026-10-12' },
        { communityId: free.id, validUntil: FAR, payment: 0, paidOn: '2026-10-01' },
      ],
    })
    // b: admin-added, never finished signing up in the app (₹500 on 10 Sep)
    await createMobileMember({
      name: 'Bhavna Pending', password: null, createdAt: at('2026-09-20T05:00:00Z'),
      subscriptions: [{ communityId: swing.id, validUntil: '2026-12-01', payment: 500, paidOn: '2026-09-10' }],
    })
    // c: Options, ₹2,000 paid today
    await createMobileMember({
      name: 'Chirag Options', createdAt: at('2026-10-02T05:00:00Z'),
      subscriptions: [{ communityId: options.id, validUntil: '2026-11-30', payment: 2000, paidOn: '2026-10-25' }],
    })
    // d: lapsed Swing member (₹250 on 5 Sep)
    await createMobileMember({
      name: 'Divya Expired', createdAt: at('2026-08-01T05:00:00Z'),
      subscriptions: [{ communityId: swing.id, validUntil: '2026-09-01', isActive: false, payment: 250, paidOn: '2026-09-05' }],
    })
    // e: ₹7,000 on 28 Sep — after the 25th, so outside the Sep 1–25 comparison window
    await createMobileMember({
      name: 'Esha Late', createdAt: at('2026-08-05T05:00:00Z'),
      subscriptions: [{ communityId: options.id, validUntil: '2026-11-01', payment: 7000, paidOn: '2026-09-28' }],
    })
    // f/g: created 00:30 IST on 1 Oct vs 23:30 IST on 30 Sep — either side of the month boundary
    await createMobileMember({ name: 'Farhan Boundary', createdAt: at('2026-09-30T19:00:00Z') })
    await createMobileMember({ name: 'Gita Boundary', createdAt: at('2026-09-30T18:00:00Z') })

    // Tickets: t1 swing/new, t2 options/replied, t3 swing/resolved
    await createTicket({ userId: a.id, communityId: swing.id })
    await createTicket({ userId: a.id, communityId: options.id, repliedBy: superAdmin.id })
    await createTicket({ userId: a.id, communityId: swing.id, status: 'resolved' })

    // Service enquiries (global): new, quote sent (replied), paid (has an invoice), closed
    await createServiceRequest({ userId: a.id, status: 'requested' })
    await createServiceRequest({ userId: a.id, status: 'quote_sent', repliedBy: superAdmin.id })
    const paid = await createServiceRequest({ userId: a.id, status: 'paid', repliedBy: superAdmin.id })
    await createServiceRequest({ userId: a.id, status: 'closed', repliedBy: superAdmin.id })
    await createServiceInvoice({
      requestId: paid.id, userId: a.id, adminId: superAdmin.id, total: 1180, issuedAt: at('2026-10-20T10:00:00Z'),
    })

    limited = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  })

  describe('GET /kpis', () => {
    it('shows a super admin the whole business', async () => {
      const res = await get(superAdmin, '/kpis')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual({
        // a–g; admins are never counted
        totalMembers: { value: 7, newThisMonth: 3 }, // a, c and f (00:30 IST on 1 Oct)
        // Registered + active + not expired, free tier excluded: a (Swing), c, e. Not b (pending) or d (lapsed).
        activeSubscriptions: { value: 3, pendingRegistration: 1 },
        revenue: {
          amount: 4180, // 1000 + 2000 subscriptions + 1180 service invoice
          previousAmount: 750, // 500 + 250 (the ₹7,000 on 28 Sep is outside 1–25)
          deltaPercent: 457.3,
          from: '2026-10-01',
          through: '2026-10-25',
        },
        tickets: { openTickets: 2, openEnquiries: 3, awaitingFirstReply: 2 }, // new ticket + new enquiry
      })
    })

    it('limits a community admin to their communities, with no company-wide service income', async () => {
      const res = await get(limited, '/kpis')

      expect(res.body.data).toEqual({
        totalMembers: { value: 3, newThisMonth: 1 }, // a, b, d are in Swing
        activeSubscriptions: { value: 1, pendingRegistration: 1 },
        revenue: { amount: 1000, previousAmount: 750, deltaPercent: 33.3, from: '2026-10-01', through: '2026-10-25' },
        // Tickets follow the admin's communities; service enquiries are global by design.
        tickets: { openTickets: 1, openEnquiries: 3, awaitingFirstReply: 2 },
      })
    })

    it('shows an admin who manages no communities nothing but the global enquiries', async () => {
      const nobody = await createAdmin({ isSuperAdmin: false, communityIds: [] })
      const res = await get(nobody, '/kpis')

      expect(res.body.data.totalMembers).toEqual({ value: 0, newThisMonth: 0 })
      expect(res.body.data.activeSubscriptions).toEqual({ value: 0, pendingRegistration: 0 })
      expect(res.body.data.revenue).toMatchObject({ amount: 0, previousAmount: 0, deltaPercent: null })
      expect(res.body.data.tickets.openTickets).toBe(0)
      expect(res.body.data.tickets.openEnquiries).toBe(3)
    })
  })

  describe('GET /revenue', () => {
    it('returns the running month day by day, zero-filled, against the same days last month', async () => {
      const res = await get(superAdmin, '/revenue')
      const d = res.body.data

      expect(res.status).toBe(200)
      expect(d).toMatchObject({
        month: '2026-10',
        previousMonth: '2026-09',
        throughDay: 25,
        totalCurrent: 4180,
        totalPrevious: 750,
        deltaPercent: 457.3,
      })
      expect(d.current).toHaveLength(25)
      expect(d.previous).toHaveLength(25) // Sep 1–25, not all of September
      expect(d.current[0]).toEqual({ day: 1, date: '2026-10-01', amount: 0 })
      expect(d.current[11]).toEqual({ day: 12, date: '2026-10-12', amount: 1000 })
      expect(d.current[19]).toEqual({ day: 20, date: '2026-10-20', amount: 1180 }) // invoice, 15:30 IST
      expect(d.current[24]).toEqual({ day: 25, date: '2026-10-25', amount: 2000 })
      expect(d.previous[4]).toEqual({ day: 5, date: '2026-09-05', amount: 250 })
      expect(d.previous[9]).toEqual({ day: 10, date: '2026-09-10', amount: 500 })
    })

    it('shows a finished month in full, compared with the whole previous month', async () => {
      const d = (await get(superAdmin, '/revenue', { month: '2026-09' })).body.data

      expect(d.throughDay).toBe(30)
      expect(d.current).toHaveLength(30)
      expect(d.previous).toHaveLength(30) // August has 31 days — cut to match September's 30
      expect(d.current[27]).toEqual({ day: 28, date: '2026-09-28', amount: 7000 })
      expect(d.totalCurrent).toBe(7750)
      expect(d.totalPrevious).toBe(0)
      expect(d.deltaPercent).toBeNull() // nothing to compare against — not "infinity"
    })

    it('compares a 31-day month with a shorter one without inventing days', async () => {
      const d = (await get(superAdmin, '/revenue', { month: '2026-03' })).body.data
      expect(d.current).toHaveLength(31)
      expect(d.previous).toHaveLength(28) // February 2026
    })

    it('shows a community admin only their communities\' subscription revenue', async () => {
      const d = (await get(limited, '/revenue')).body.data

      expect(d.current[11].amount).toBe(1000) // a, Swing
      expect(d.current[24].amount).toBe(0) // c (Options) is not theirs
      expect(d.current[19].amount).toBe(0) // service invoice is company-wide: super admin only
      expect(d.totalCurrent).toBe(1000)
      expect(d.totalPrevious).toBe(750)
    })

    it('shows an admin with no communities flat zeros', async () => {
      const nobody = await createAdmin({ isSuperAdmin: false, communityIds: [] })
      const d = (await get(nobody, '/revenue')).body.data
      expect(d.totalCurrent).toBe(0)
      expect(d.current.every((p: { amount: number }) => p.amount === 0)).toBe(true)
    })

    it.each([
      ['a future month', '2026-11'],
      ['an invalid month number', '2026-13'],
      ['free text', 'october'],
      ['an unpadded month', '2026-1'],
    ])('rejects %s', async (_label, month) => {
      expect((await get(superAdmin, '/revenue', { month })).status).toBe(400)
    })
  })
})

describe('GET /revenue — IST day boundaries', () => {
  it('puts a payment on the IST calendar day, not the UTC day', async () => {
    const m = await createMobileMember()
    // No paid-on date on record (bulk import) → falls back to when the row was created.
    const unpaidOn = (createdAt: string, payment: number) => ({
      userId: m.id,
      communityId: swing.id,
      validUntil: at('2026-12-01'),
      payment,
      paidOn: null,
      createdAt: at(createdAt),
    })
    await prisma.subscription.createMany({
      data: [
        unpaidOn('2026-09-30T19:00:00Z', 300), // 00:30 IST, 1 Oct
        unpaidOn('2026-09-30T18:00:00Z', 50), // 23:30 IST, 30 Sep
        unpaidOn('2026-10-24T19:00:00Z', 400), // 00:30 IST, 25 Oct
        unpaidOn('2026-10-25T19:00:00Z', 999), // 00:30 IST, 26 Oct: tomorrow
      ],
    })
    const r1 = await createServiceRequest({ userId: m.id, status: 'paid' })
    const r2 = await createServiceRequest({ userId: m.id, status: 'paid' })
    await createServiceInvoice({ requestId: r1.id, userId: m.id, adminId: superAdmin.id, total: 100, issuedAt: at('2026-09-30T19:00:00Z') }) // 1 Oct
    await createServiceInvoice({ requestId: r2.id, userId: m.id, adminId: superAdmin.id, total: 70, issuedAt: at('2026-09-30T18:00:00Z') }) // 30 Sep

    const d = (await get(superAdmin, '/revenue')).body.data

    expect(d.current[0]).toEqual({ day: 1, date: '2026-10-01', amount: 400 }) // 300 + 100
    expect(d.current[24].amount).toBe(400)
    expect(d.totalCurrent).toBe(800) // the ₹999 row (26 Oct IST) is in the future: not counted
    expect(d.previous.at(-1).date).toBe('2026-09-25') // the comparison window ends on 25 Sep
    const sep30 = (await get(superAdmin, '/revenue', { month: '2026-09' })).body.data.current[29]
    expect(sep30).toEqual({ day: 30, date: '2026-09-30', amount: 120 }) // 50 + 70
  })

  it('counts every payment once: renewals, superseded rows and zero-value free rows', async () => {
    const m = await createMobileMember({
      subscriptions: [
        { communityId: swing.id, validUntil: '2026-06-01', isActive: false, payment: 1000, paidOn: '2026-10-05' },
        { communityId: swing.id, validUntil: '2027-06-01', payment: 1500, paidOn: '2026-10-05' },
        { communityId: free.id, validUntil: FAR, payment: 0, paidOn: '2026-10-05' },
      ],
    })
    expect(m.subscriptionIds).toHaveLength(3)
    const d = (await get(superAdmin, '/revenue')).body.data
    expect(d.current[4]).toEqual({ day: 5, date: '2026-10-05', amount: 2500 })
  })
})

describe('GET /expiring', () => {
  let limited: TestAdmin

  beforeEach(async () => {
    const sub = (communityId: string, validUntil: string, extra: { isActive?: boolean } = {}) => ({
      communityId, validUntil, ...extra,
    })
    await createMobileMember({ name: 'Nikhil Sen', subscriptions: [sub(swing.id, '2026-10-25')] }) // today
    await createMobileMember({ name: 'Ram Mehta', subscriptions: [sub(options.id, '2026-10-27')] })
    await createMobileMember({ name: 'Raghav Sen', subscriptions: [sub(swing.id, '2026-11-01')] }) // day 7, inclusive
    // none of these belong on the list:
    await createMobileMember({ name: 'Too Late', subscriptions: [sub(swing.id, '2026-11-02')] }) // day 8
    await createMobileMember({ name: 'Already Expired', subscriptions: [sub(swing.id, '2026-10-24')] })
    await createMobileMember({ name: 'Renewed Away', subscriptions: [sub(swing.id, '2026-10-28', { isActive: false })] })
    await createMobileMember({ name: 'Free Tier', subscriptions: [sub(free.id, '2026-10-28')] })
    await createMobileMember({ name: 'Suspended Sam', status: 'suspended', subscriptions: [sub(swing.id, '2026-10-28')] })
    limited = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  })

  it('lists the next 7 days soonest-first, with days left', async () => {
    const res = await get(superAdmin, '/expiring')

    expect(res.status).toBe(200)
    expect(res.body.data.windowDays).toBe(7)
    expect(res.body.data.total).toBe(3)
    expect(
      res.body.data.items.map((i: { name: string; initials: string; communityName: string; validUntil: string; daysLeft: number }) =>
        [i.name, i.initials, i.communityName, i.validUntil, i.daysLeft]),
    ).toEqual([
      ['Nikhil Sen', 'NS', 'Swing Traders', '2026-10-25', 0],
      ['Ram Mehta', 'RM', 'Options Lab', '2026-10-27', 2],
      ['Raghav Sen', 'RS', 'Swing Traders', '2026-11-01', 7],
    ])
  })

  it('caps the list at the limit but still reports the full count', async () => {
    const res = await get(superAdmin, '/expiring', { limit: 2 })
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.total).toBe(3)
  })

  it('shows a community admin only their communities', async () => {
    const res = await get(limited, '/expiring')
    expect(res.body.data.items.map((i: { name: string }) => i.name)).toEqual(['Nikhil Sen', 'Raghav Sen'])
    expect(res.body.data.total).toBe(2)
  })

  it.each(['0', '21', 'abc'])('rejects limit=%s', async limit => {
    expect((await get(superAdmin, '/expiring', { limit })).status).toBe(400)
  })
})

describe('GET /registrations', () => {
  let limited: TestAdmin

  beforeEach(async () => {
    await createMobileMember({
      name: 'Newest Admin-Added', password: null, createdAt: at('2026-10-25T07:00:00Z'), email: 'new@example.com',
      subscriptions: [{ communityId: swing.id, validUntil: '2026-12-01' }],
    })
    await createMobileMember({
      name: 'Self Signup', source: 'self', createdAt: at('2026-10-24T05:00:00Z'),
      subscriptions: [{ communityId: free.id, validUntil: FAR, payment: 0 }],
    })
    await createMobileMember({
      name: 'Two Communities', createdAt: at('2026-10-20T05:00:00Z'),
      subscriptions: [
        { communityId: swing.id, validUntil: '2026-12-01', createdAt: at('2026-10-01T00:00:00Z') },
        { communityId: options.id, validUntil: '2026-12-01', createdAt: at('2026-10-10T00:00:00Z') },
      ],
    })
    await createMobileMember({ name: 'Suspended Sam', source: 'self', status: 'suspended', createdAt: at('2026-10-19T05:00:00Z') })
    await createMobileMember({ name: 'Deleted Dan', source: 'self', status: 'deleted', createdAt: at('2026-10-23T05:00:00Z') })
    await createMobileMember({ name: 'Old Timer', createdAt: at('2026-09-01T05:00:00Z') })
    limited = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  })

  it('lists the latest members with how they joined and where they are in sign-up', async () => {
    const res = await get(superAdmin, '/registrations')

    expect(res.status).toBe(200)
    const items = res.body.data.items
    expect(items.map((i: { name: string }) => i.name)).toEqual([
      'Newest Admin-Added', 'Self Signup', 'Two Communities', 'Suspended Sam', 'Old Timer', // Deleted Dan is hidden
    ])
    expect(items[0]).toMatchObject({
      initials: 'NA',
      email: 'new@example.com',
      registeredAt: '2026-10-25T07:00:00.000Z',
      source: 'admin',
      registrationStatus: 'pending',
      accountStatus: 'active',
      communityName: 'Swing Traders',
    })
    expect(items[1]).toMatchObject({ source: 'self', registrationStatus: 'registered', communityName: null }) // free tier only
    expect(items[2]).toMatchObject({ communityName: 'Options Lab' }) // most recently added paid community
    expect(items[3]).toMatchObject({ accountStatus: 'suspended' })
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/)
  })

  it('counts sign-ups from the last 7 days, excluding deleted accounts', async () => {
    // from 18 Oct 13:30 IST: Newest, Self Signup, Two Communities, Suspended Sam
    expect((await get(superAdmin, '/registrations')).body.data.last7DaysCount).toBe(4)
  })

  it('honours the limit', async () => {
    const res = await get(superAdmin, '/registrations', { limit: 2 })
    expect(res.body.data.items).toHaveLength(2)
  })

  it('shows a community admin only their members, and only communities they can see', async () => {
    const res = await get(limited, '/registrations')

    expect(res.body.data.items.map((i: { name: string }) => i.name)).toEqual(['Newest Admin-Added', 'Two Communities'])
    // "Two Communities" also belongs to Options Lab — not this admin's, so it must not be named.
    expect(res.body.data.items[1].communityName).toBe('Swing Traders')
    expect(res.body.data.last7DaysCount).toBe(2)
  })

  it.each(['0', '21', 'abc'])('rejects limit=%s', async limit => {
    expect((await get(superAdmin, '/registrations', { limit })).status).toBe(400)
  })
})

describe('GET /tickets', () => {
  let limited: TestAdmin
  let ids: Record<string, string>
  let nums: Record<string, number>

  beforeEach(async () => {
    const u = await createMobileMember({ name: 'Priya Shah' })
    const title = 'Portfolio Analysis'
    const mk = {
      t1: await createTicket({ userId: u.id, communityId: swing.id, subject: 'Payment not reflecting', lastMessageAt: at('2026-10-25T07:00:00Z') }),
      t2: await createTicket({ userId: u.id, communityId: options.id, subject: 'Options help', lastMessageAt: at('2026-10-25T06:00:00Z'), repliedBy: superAdmin.id }),
      t3: await createTicket({ userId: u.id, communityId: swing.id, subject: 'Unable to join', status: 'in_progress', lastMessageAt: at('2026-10-24T05:00:00Z'), repliedBy: superAdmin.id }),
      t4: await createTicket({ userId: u.id, communityId: swing.id, subject: 'Old one', status: 'resolved', lastMessageAt: at('2026-10-23T05:00:00Z') }),
      s1: await createServiceRequest({ userId: u.id, title, lastMessageAt: at('2026-10-25T07:30:00Z') }),
      s2: await createServiceRequest({ userId: u.id, title, status: 'quote_sent', lastMessageAt: at('2026-10-25T05:00:00Z'), repliedBy: superAdmin.id }),
      s3: await createServiceRequest({ userId: u.id, title, status: 'paid', lastMessageAt: at('2026-10-22T05:00:00Z'), repliedBy: superAdmin.id }),
      s4: await createServiceRequest({ userId: u.id, title, status: 'closed', lastMessageAt: at('2026-10-21T05:00:00Z'), repliedBy: superAdmin.id }),
      s5: await createServiceRequest({ userId: u.id, title, lastMessageAt: at('2026-10-20T05:00:00Z'), repliedBy: superAdmin.id }),
    }
    ids = Object.fromEntries(Object.entries(mk).map(([k, v]) => [k, v.id]))
    nums = Object.fromEntries(Object.entries(mk).map(([k, v]) => [k, v.number]))
    limited = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  })

  const keys = (items: { id: string }[]) =>
    items.map(i => Object.entries(ids).find(([, id]) => id === i.id)![0])

  it('merges support tickets and service enquiries by last update, newest first', async () => {
    const res = await get(superAdmin, '/tickets')

    expect(res.status).toBe(200)
    expect(keys(res.body.data.items)).toEqual(['s1', 't1', 't2', 's2', 't3'])
    expect(res.body.data.items[0]).toEqual({
      id: ids['s1'],
      kind: 'service',
      label: `SR-${nums['s1']}`,
      member: { id: expect.any(String), name: 'Priya Shah', initials: 'PS' },
      typeLabel: 'Service enquiry',
      subject: 'Portfolio Analysis',
      status: { key: 'new', label: 'New', tone: 'danger' },
      lastUpdateAt: '2026-10-25T07:30:00.000Z',
    })
    expect(res.body.data.items[1]).toMatchObject({
      kind: 'support',
      label: `FS-${nums['t1']}`,
      typeLabel: 'Support',
      subject: 'Payment not reflecting',
    })
  })

  it('derives a status from the thread: new until an admin replies', async () => {
    const res = await get(superAdmin, '/tickets', { limit: 20 })
    const statusOf = (key: string) =>
      res.body.data.items.find((i: { id: string }) => i.id === ids[key]).status.key

    expect(res.body.data.items).toHaveLength(9)
    expect(['t1', 't2', 't3', 't4'].map(statusOf)).toEqual(['new', 'replied', 'in_progress', 'resolved'])
    expect(['s1', 's2', 's3', 's4', 's5'].map(statusOf)).toEqual(['new', 'quote_sent', 'paid', 'closed', 'replied'])
  })

  it('takes exactly the top N of the merged list, whichever table they come from', async () => {
    expect(keys((await get(superAdmin, '/tickets', { limit: 1 })).body.data.items)).toEqual(['s1'])
    expect(keys((await get(superAdmin, '/tickets', { limit: 3 })).body.data.items)).toEqual(['s1', 't1', 't2'])
  })

  it('limits a community admin\'s tickets to their communities but leaves global service enquiries visible', async () => {
    const items = (await get(limited, '/tickets', { limit: 20 })).body.data.items
    const found = keys(items)

    expect(found).not.toContain('t2') // Options ticket
    expect(found).toEqual(['s1', 't1', 's2', 't3', 't4', 's3', 's4', 's5'])
  })

  it.each(['0', '21', 'abc'])('rejects limit=%s', async limit => {
    expect((await get(superAdmin, '/tickets', { limit })).status).toBe(400)
  })
})
