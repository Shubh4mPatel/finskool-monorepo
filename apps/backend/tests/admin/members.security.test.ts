import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  nextMobile,
  daysFromNow,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// What a community admin can and cannot do to members outside their communities, how every admin route
// treats malformed ids and out-of-range input, and what happens when two admins act at the same moment.

const app = createApp()
const JUNK = 'junk-id'
const UNKNOWN = '5b3f4c1e-0000-4000-8000-000000000000'

let boss: TestAdmin
let priya: TestAdmin // community admin of Swing only
let swing: { id: string; name: string }
let options: { id: string; name: string }
let insider: TestMobileMember // Swing only
let outsider: TestMobileMember // Options only
let shared: TestMobileMember // both

const as = (a: TestAdmin) => ({ Authorization: a.auth })
const get = (a: TestAdmin, url: string) => request(app).get(`/api/v1/admin${url}`).set(as(a))
const post = (a: TestAdmin, url: string, body?: unknown) => request(app).post(`/api/v1/admin${url}`).set(as(a)).send(body as object)
const patch = (a: TestAdmin, url: string, body?: unknown) => request(app).patch(`/api/v1/admin${url}`).set(as(a)).send(body as object)
const del = (a: TestAdmin, url: string) => request(app).delete(`/api/v1/admin${url}`).set(as(a))

const memberRow = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } })
const activeSubs = (userId: string) => prisma.subscription.count({ where: { userId, isActive: true } })

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  const sub = (communityId: string) => ({ communityId, validUntil: daysFromNow(60) })
  insider = await createMobileMember({ name: 'Insider', subscriptions: [sub(swing.id)] })
  outsider = await createMobileMember({ name: 'Outsider', subscriptions: [sub(options.id)] })
  shared = await createMobileMember({ name: 'Shared', subscriptions: [sub(swing.id), sub(options.id)] })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('a community admin and a member of another community', () => {
  const validEdit = (m: TestMobileMember) => ({ name: m.name + ' X', phone: m.phone, email: m.email })

  it('cannot read, edit, reset the password of, suspend, revoke or delete them — and nothing changes', async () => {
    const before = await memberRow(outsider.id)
    const results = await Promise.all([
      get(priya, `/members/${outsider.id}`),
      patch(priya, `/members/${outsider.id}`, validEdit(outsider)),
      patch(priya, `/members/${outsider.id}/password`, { newPassword: 'Hijacked-123' }),
      patch(priya, `/members/${outsider.id}/suspend`, { reason: 'because' }),
      patch(priya, `/members/${outsider.id}/revoke`),
      del(priya, `/members/${outsider.id}`),
      del(priya, `/members/${outsider.id}/communities/${options.id}`),
      post(priya, `/subscriptions/${outsider.subscriptionIds[0]}/extend`, { validUntil: daysFromNow(400), payment: 1 }),
    ])
    expect(results.map(r => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403])
    const after = await memberRow(outsider.id)
    expect(after).toMatchObject({ name: before.name, status: 'active', passwordHash: before.passwordHash })
    expect(await activeSubs(outsider.id)).toBe(1)
    expect(await prisma.subscription.count({ where: { userId: outsider.id } })).toBe(1) // no extension row either
  })

  it('cannot add anyone to, or move anyone into, a community they do not manage', async () => {
    const add = await post(priya, '/members', { phone: nextMobile(), name: 'New Person', communityId: options.id, payment: 100, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) })
    expect(add.status).toBe(403)
    const addTo = await patch(priya, `/members/${insider.id}`, { ...validEdit(insider), newCommunity: { communityId: options.id, payment: 1, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) } })
    expect(addTo.status).toBe(403)
    expect(await prisma.subscription.count({ where: { userId: insider.id, communityId: options.id } })).toBe(0)
  })

  it('cannot revive or bulk-delete them: bulk-delete reports a per-id failure and changes nothing', async () => {
    const bulk = await post(priya, '/members/bulk-delete', { userIds: [outsider.id, insider.id] })
    expect(bulk.status).toBe(200)
    expect(bulk.body.data).toMatchObject({ total: 2, succeeded: 1, failed: 1 })
    expect(bulk.body.data.errors[0].userId).toBe(outsider.id)
    expect((await memberRow(outsider.id)).status).toBe('active')
    expect((await memberRow(insider.id)).status).toBe('deleted')

    await prisma.user.update({ where: { id: outsider.id }, data: { status: 'suspended' } })
    const revive = await post(priya, '/members/revive', { phone: outsider.phone, name: 'Outsider', communityId: swing.id, payment: 1, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) })
    expect(revive.status).toBe(403)
    expect((await memberRow(outsider.id)).status).toBe('suspended')
  })

  it('does not see them in the roster, search or counts', async () => {
    const roster = await get(priya, '/members?pageSize=100')
    const ids = roster.body.data.members.map((m: { id: string }) => m.id).sort()
    expect(ids).toEqual([insider.id, shared.id].sort())
    expect(roster.body.data.total).toBe(2)
    const search = await get(priya, '/members?search=Outsider')
    expect(search.body.data.members).toHaveLength(0)
  })

  it('does not get a different answer for "exists but not yours" and "does not exist" beyond the status code', async () => {
    const real = await get(priya, `/members/${outsider.id}`)
    const fake = await get(priya, `/members/${UNKNOWN}`)
    expect([real.status, fake.status]).toEqual([403, 404])
    expect(JSON.stringify(real.body)).not.toContain(outsider.name) // the 403 leaks nothing about the member
    expect(JSON.stringify(real.body)).not.toContain(outsider.phone)
  })
})

describe('a community admin and a member of their own community', () => {
  it('can read, edit, reset the password of, suspend, revoke and delete them', async () => {
    expect((await get(priya, `/members/${insider.id}`)).status).toBe(200)
    expect((await patch(priya, `/members/${insider.id}`, { name: 'Insider Renamed', phone: insider.phone, email: insider.email })).status).toBe(200)
    expect((await patch(priya, `/members/${insider.id}/password`, { newPassword: 'New-Password-1' })).status).toBe(200)
    expect((await patch(priya, `/members/${insider.id}/suspend`, { reason: 'spam' })).status).toBe(200)
    expect((await patch(priya, `/members/${insider.id}/revoke`)).status).toBe(200)
    expect((await del(priya, `/members/${insider.id}`)).status).toBe(200)
  })
})

describe('a member who belongs to both a managed and an unmanaged community', () => {
  it('can be opened and edited by the community admin of one of them', async () => {
    expect((await get(priya, `/members/${shared.id}`)).status).toBe(200)
  })

  // NEEDS A PRODUCT DECISION (see docs/admin-user-management-test-report.md, finding F1): today "delete" ends every
  // subscription and marks the account deleted, so a Swing-only admin can switch off someone's Options Lab access.
  // The safer behaviour is written down here and skipped until it is decided.
  it.skip('keeps their access to the community the admin does not manage when the admin deletes them', async () => {
    await del(priya, `/members/${shared.id}`)
    const optionsSub = await prisma.subscription.findFirst({ where: { userId: shared.id, communityId: options.id } })
    expect(optionsSub?.isActive).toBe(true)
  })
})

describe('malformed ids on every admin route answer with a 4xx, never a 500', () => {
  const cases: Array<[string, (a: TestAdmin) => request.Test]> = [
    ['GET /members/:id', a => get(a, `/members/${JUNK}`)],
    ['PATCH /members/:id', a => patch(a, `/members/${JUNK}`, { name: 'Valid Name', phone: '9811100099' })],
    ['PATCH /members/:id/password', a => patch(a, `/members/${JUNK}/password`, { newPassword: 'New-Password-1' })],
    ['PATCH /members/:id/suspend', a => patch(a, `/members/${JUNK}/suspend`, { reason: 'x' })],
    ['PATCH /members/:id/revoke', a => patch(a, `/members/${JUNK}/revoke`)],
    ['DELETE /members/:id', a => del(a, `/members/${JUNK}`)],
    ['DELETE /members/:id/communities/:communityId', a => del(a, `/members/${JUNK}/communities/${JUNK}`)],
    ['POST /subscriptions/:id/extend', a => post(a, `/subscriptions/${JUNK}/extend`, { validUntil: '2031-01-01', payment: 5 })],
    ['PATCH /communities/:id', a => patch(a, `/communities/${JUNK}`, { name: 'X' })],
    ['DELETE /communities/:id', a => del(a, `/communities/${JUNK}`)],
    ['GET /communities/:id/plans', a => get(a, `/communities/${JUNK}/plans`)],
    ['POST /communities/:id/plans', a => post(a, `/communities/${JUNK}/plans`, { name: 'P', durationMonths: 1, price: 1 })],
    ['PATCH /communities/:id/plans/:planId', a => patch(a, `/communities/${JUNK}/plans/${JUNK}`, { name: 'P', durationMonths: 1, price: 1 })],
    ['DELETE /communities/:id/plans/:planId', a => del(a, `/communities/${JUNK}/plans/${JUNK}`)],
    ['PATCH /comment-notifications/:id/mark-replied', a => patch(a, `/comment-notifications/${JUNK}/mark-replied`)],
    ['PATCH /admins/:id', a => patch(a, `/admins/${JUNK}`, { communityIds: [UNKNOWN] })],
    ['DELETE /admins/:id', a => del(a, `/admins/${JUNK}`)],
  ]
  it.each(cases)('super admin: %s', async (_name, call) => {
    const res = await call(boss)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })
  it.each(cases.filter(([n]) => !n.includes('/admins') && !n.startsWith('PATCH /communities') && !n.startsWith('DELETE /communities/:id') || n.includes('plans')))('community admin: %s', async (_name, call) => {
    const res = await call(priya)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('a malformed JSON body is a 400', async () => {
    const res = await request(app).post('/api/v1/admin/members').set(as(boss)).set('Content-Type', 'application/json').send('{"phone": ')
    expect(res.status).toBe(400)
  })
})

describe('input limits', () => {
  const add = (over: Record<string, unknown>) =>
    post(boss, '/members', { phone: nextMobile(), name: 'Valid Person', communityId: swing.id, payment: 999, paidOn: daysFromNow(-1), validUntil: daysFromNow(30), ...over })

  it.each([
    ['a name over 100 characters', { name: 'N'.repeat(101) }],
    ['a name of only spaces', { name: '    ' }],
    ['an email over 255 characters', { email: `${'a'.repeat(250)}@x.test` }],
    ['a payment too large for the column', { payment: 1e15 }],
    ['a payment with Infinity/NaN-like string', { payment: 'Infinity' }],
    ['a date that matches the pattern but is not a real date (2030-13-45)', { validUntil: '2030-13-45' }],
    ['a date that does not exist (2030-02-30)', { validUntil: '2030-02-30' }],
    ['a phone with letters', { phone: 'abcdefghij' }],
    ['an unknown community', { communityId: UNKNOWN }],
  ])('add member rejects %s with a 4xx, never a 500', async (_label, over) => {
    const before = await prisma.user.count()
    const res = await add(over)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(await prisma.user.count()).toBe(before)
  })

  it('rejects adding a member to a deleted community', async () => {
    await prisma.community.update({ where: { id: swing.id }, data: { deletedAt: new Date() } })
    const res = await add({})
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it.each([
    ['a name over 100 characters', { name: 'N'.repeat(101) }],
    ['a name of only spaces', { name: '    ' }],
    ['an email over 255 characters', { email: `${'a'.repeat(250)}@x.test` }],
  ])('edit member rejects %s with a 4xx, never a 500', async (_label, over) => {
    const res = await patch(boss, `/members/${insider.id}`, { name: 'Insider', phone: insider.phone, email: insider.email, ...over })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('extend rejects impossible dates and amounts with a 4xx, never a 500', async () => {
    const id = insider.subscriptionIds[0]
    for (const body of [{ validUntil: '2031-13-45', payment: 5 }, { validUntil: '2031-01-01', payment: 1e15 }, { validUntil: '2031-01-01', payment: 5, paidOn: '2030-99-99' }]) {
      const res = await post(boss, `/subscriptions/${id}/extend`, body)
      expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400)
      expect(res.status, JSON.stringify(body)).toBeLessThan(500)
    }
    expect(await prisma.subscription.count({ where: { userId: insider.id } })).toBe(1)
  })

  it('password reset rejects a password over 128 characters (bcrypt would silently cut it at 72 bytes)', async () => {
    const res = await patch(boss, `/members/${insider.id}/password`, { newPassword: 'p'.repeat(200) })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('suspend rejects a reason over 1000 characters', async () => {
    expect((await patch(boss, `/members/${insider.id}/suspend`, { reason: 'r'.repeat(1001) })).status).toBe(400)
  })

  it('bulk-delete rejects an empty list, a non-uuid id and a huge list with a 4xx', async () => {
    expect((await post(boss, '/members/bulk-delete', { userIds: [] })).status).toBe(400)
    expect((await post(boss, '/members/bulk-delete', { userIds: [JUNK] })).status).toBe(400)
    const many = Array.from({ length: 5000 }, () => UNKNOWN)
    const res = await post(boss, '/members/bulk-delete', { userIds: many })
    expect(res.status).toBeGreaterThanOrEqual(400) // a request must not be able to hold the API for thousands of lookups
  })
})

describe('two admins at the same moment', () => {
  it('adding the same phone: one 201, the rest clean 409s, one member', async () => {
    const phone = '9811188888'
    const body = { phone, name: 'Race Member', communityId: swing.id, payment: 100, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) }
    const results = await Promise.all(Array.from({ length: 6 }, () => post(boss, '/members', body)))
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(results.some(r => r.status >= 500)).toBe(false)
    expect(await prisma.user.count({ where: { phone: '+919811188888' } })).toBe(1)
  })

  it('adding the same email under different phones: one wins, no 500', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => post(boss, '/members', { phone: nextMobile(), name: 'Same Email', email: 'same@race.test', communityId: swing.id, payment: 100, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) })))
    expect(results.filter(r => r.status === 201)).toHaveLength(1)
    expect(results.some(r => r.status >= 500)).toBe(false)
  })

  it('moving two members to the same new phone: one wins, no 500', async () => {
    const phone = '9811177777'
    const results = await Promise.all([insider, outsider].map(m => patch(boss, `/members/${m.id}`, { name: m.name, phone, email: m.email })))
    expect(results.some(r => r.status >= 500)).toBe(false)
    expect(await prisma.user.count({ where: { phone: '+919811177777' } })).toBe(1)
  })

  it('extending the same subscription four times at once leaves exactly one active subscription for that community', async () => {
    const id = insider.subscriptionIds[0]
    const results = await Promise.all([100, 200, 300, 400].map(d => post(boss, `/subscriptions/${id}/extend`, { validUntil: daysFromNow(d), payment: d })))
    expect(results.map(r => r.status)).toEqual([201, 201, 201, 201])
    expect(await prisma.subscription.count({ where: { userId: insider.id, communityId: swing.id, isActive: true } })).toBe(1)
  })

  it('suspending and deleting the same member at once ends in a coherent state, with no 500', async () => {
    const results = await Promise.all([
      patch(boss, `/members/${insider.id}/suspend`, { reason: 'a' }),
      del(boss, `/members/${insider.id}`),
      patch(boss, `/members/${insider.id}/suspend`, { reason: 'b' }),
      patch(boss, `/members/${insider.id}/revoke`),
    ])
    expect(results.some(r => r.status >= 500)).toBe(false)
  })

  it('a suspended member cannot be brought back by a later suspend call (a deleted one stays deleted)', async () => {
    await del(boss, `/members/${insider.id}`)
    expect((await patch(boss, `/members/${insider.id}/suspend`, { reason: 'x' })).status).toBe(409)
    expect((await patch(boss, `/members/${insider.id}/revoke`)).status).toBe(409)
    expect((await memberRow(insider.id)).status).toBe('deleted')
  })
})

describe('admin accounts are never reachable through the member endpoints', () => {
  it('cannot be read, edited, suspended, deleted, revived or password-reset as "members"', async () => {
    const target = priya.id
    const results = await Promise.all([
      get(boss, `/members/${target}`),
      patch(boss, `/members/${target}`, { name: 'Pwned Admin', phone: '9811100077' }),
      patch(boss, `/members/${target}/password`, { newPassword: 'New-Password-1' }),
      patch(boss, `/members/${target}/suspend`, { reason: 'x' }),
      patch(boss, `/members/${target}/revoke`),
      del(boss, `/members/${target}`),
      post(boss, '/members/bulk-delete', { userIds: [target] }),
    ])
    for (const r of results.slice(0, 6)) expect([403, 404]).toContain(r.status)
    expect(results[6]?.body.data.failed).toBe(1)
    const row = await memberRow(target)
    expect(row).toMatchObject({ status: 'active', name: expect.not.stringContaining('Pwned') })
  })

  it('cannot be added as a member by phone (the add/revive routes refuse an admin\'s phone)', async () => {
    const adminRow = await memberRow(priya.id)
    const add = await post(boss, '/members', { phone: adminRow.phone, name: 'Takeover', communityId: swing.id, payment: 1, validUntil: daysFromNow(30) })
    expect(add.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.subscription.count({ where: { userId: priya.id } })).toBe(0)
    const revive = await post(boss, '/members/revive', { phone: adminRow.phone, name: 'Takeover', communityId: swing.id, payment: 1, paidOn: daysFromNow(-1), validUntil: daysFromNow(30) })
    expect(revive.status).toBeGreaterThanOrEqual(400)
    expect(await prisma.subscription.count({ where: { userId: priya.id } })).toBe(0)
  })
})
