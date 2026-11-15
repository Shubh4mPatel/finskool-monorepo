import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { notificationsQueue, SUBSCRIPTION_EXTENDED_EMAIL_JOB } from '../../src/lib/queue.js'
import {
  prisma,
  resetDb,
  createAdmin,
  createCommunity,
  createMobileMember,
  daysFromNow,
  type TestAdmin,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// Once a plan is running, an admin can only move its end date later (or leave it): the Extend action and a sheet
// import with Overwrite both refuse a date that would shorten it, and nothing about the member's plan changes.

const app = createApp()
const queueAdd = vi.mocked(notificationsQueue.add)

let admin: TestAdmin
let swing: { id: string; name: string }
let member: TestMobileMember

const extend = (subscriptionId: string, validUntil: string) =>
  request(app)
    .post(`/api/v1/admin/subscriptions/${subscriptionId}/extend`)
    .set('Authorization', admin.auth)
    .send({ validUntil, payment: 1000 })

const jobsNamed = (name: string) => queueAdd.mock.calls.filter(([n]) => n === name).map(([, payload]) => payload)
const inboxOf = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
const dateOnly = (d: Date | string) => new Date(d).toISOString().slice(0, 10)
const activeEnds = async (userId: string, communityId: string) =>
  (await prisma.subscription.findMany({ where: { userId, communityId, isActive: true } })).map(s => dateOnly(s.validUntil!))

beforeEach(async () => {
  await resetDb()
  queueAdd.mockClear()
  admin = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(admin.id, { name: 'Swing Traders' })
  member = await createMobileMember({
    name: 'Anita Rao',
    email: 'anita@example.com',
    subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }],
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('extending a running plan to an earlier date is refused', () => {
  it('answers 400 with the date it runs to, and changes nothing', async () => {
    const res = await extend(member.subscriptionIds[0]!, daysFromNow(20))

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('PLAN_REDUCTION_NOT_ALLOWED')
    expect(res.body.message).toContain(daysFromNow(60))
    expect(res.body.message).toContain('can only be moved later')

    // The plan is exactly as it was: one active row, the original end date, no history row added.
    expect(await activeEnds(member.id, swing.id)).toEqual([daysFromNow(60)])
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId: swing.id } })).toBe(1)
  })

  it('tells the member nothing, because nothing happened', async () => {
    await extend(member.subscriptionIds[0]!, daysFromNow(20))

    expect(await inboxOf(member.id)).toHaveLength(0)
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('also refuses a second attempt after a later extension, measured against the new end date', async () => {
    expect((await extend(member.subscriptionIds[0]!, daysFromNow(120))).status).toBe(201)
    const current = await prisma.subscription.findFirstOrThrow({ where: { userId: member.id, isActive: true } })

    expect((await extend(current.id, daysFromNow(90))).status).toBe(400)
    expect(await activeEnds(member.id, swing.id)).toEqual([daysFromNow(120)])
  })
})

describe('what is still allowed', () => {
  it('a later date is an extension, with the usual message', async () => {
    const res = await extend(member.subscriptionIds[0]!, daysFromNow(120))

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ validUntil: daysFromNow(120), isActive: true })
    expect(res.body.data).not.toHaveProperty('reduced')
    expect((await inboxOf(member.id)).map(n => n.type)).toEqual(['subscription-extended'])
    expect(jobsNamed(SUBSCRIPTION_EXTENDED_EMAIL_JOB)).toHaveLength(1)
  })

  it('the same end date is allowed', async () => {
    const res = await extend(member.subscriptionIds[0]!, daysFromNow(60))
    expect(res.status).toBe(201)
    expect((await inboxOf(member.id)).map(n => n.type)).toEqual(['subscription-extended'])
  })

  it('renewing a plan that had already expired, even to a date before its old end, is a renewal', async () => {
    const expired = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-10), isActive: false }],
    })
    const res = await extend(expired.subscriptionIds[0]!, daysFromNow(15))

    expect(res.status).toBe(201)
    expect(await activeEnds(expired.id, swing.id)).toEqual([daysFromNow(15)])
  })

  it('a plan in another community is not compared', async () => {
    const options = await createCommunity(admin.id, { name: 'Options Club' })
    const both = await createMobileMember({
      subscriptions: [
        { communityId: swing.id, validUntil: daysFromNow(200) },
        { communityId: options.id, validUntil: daysFromNow(10) },
      ],
    })
    const res = await extend(both.subscriptionIds[1]!, daysFromNow(30))

    expect(res.status).toBe(201)
    expect(await activeEnds(both.id, options.id)).toEqual([daysFromNow(30)])
  })
})

describe('a sheet import with Overwrite cannot shorten a running plan either', () => {
  const row = (validUntil: string) => ({ name: member.name, phone: member.phone, email: '', service: 'Swing Traders', payment: 1000, paidOn: daysFromNow(-1), valid: validUntil })
  const importOverwrite = (validUntil: string) =>
    request(app).post('/api/v1/admin/import-json').set('Authorization', admin.auth).send({ strategy: 'overwrite', rows: [row(validUntil)] })

  it('reports the row as an error and leaves the plan alone', async () => {
    const res = await importOverwrite(daysFromNow(15))

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ updated: 0, created: 0 })
    expect(res.body.data.errors).toHaveLength(1)
    expect(res.body.data.errors[0].reason).toContain('cannot be shortened')
    expect(await activeEnds(member.id, swing.id)).toEqual([daysFromNow(60)])
    expect(await inboxOf(member.id)).toHaveLength(0)
  })

  it('refuses it in an uploaded file too', async () => {
    const csv = ['Name,Contact Number,Payment,Paid on,Valid,Service,Email', `${member.name},${member.phone},1000,${daysFromNow(-1)},${daysFromNow(15)},Swing Traders,`].join('\n')
    const res = await request(app)
      .post('/api/v1/admin/import-csv?duplicateStrategy=overwrite')
      .set('Authorization', admin.auth)
      .attach('file', Buffer.from(csv), { filename: 'members.csv', contentType: 'text/csv' })

    expect(res.body.data).toMatchObject({ updated: 0 })
    expect(res.body.data.errors[0].reason).toContain('cannot be shortened')
    expect(await activeEnds(member.id, swing.id)).toEqual([daysFromNow(60)])
  })

  it('moves it later as before', async () => {
    const res = await importOverwrite(daysFromNow(150))

    expect(res.body.data).toMatchObject({ updated: 1, errors: [] })
    expect(await activeEnds(member.id, swing.id)).toEqual([daysFromNow(150)])
  })

  it('warns about it in the preview, so the admin sees it before importing', async () => {
    const res = await request(app)
      .post('/api/v1/admin/validate-import')
      .set('Authorization', admin.auth)
      .send({ rows: [{ rowNum: 1, name: member.name, phone: member.phone, email: '', service: 'Swing Traders', payment: 1000, paidOn: daysFromNow(-1), valid: daysFromNow(15) }] })

    const [result] = res.body.data.results as { errors: string[]; warnings: string[] }[]
    expect(result!.errors).toEqual([])
    expect(result!.warnings.join(' ')).toContain('cannot be shortened')
  })
})
