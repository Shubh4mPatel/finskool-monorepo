import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import {
  notificationsQueue,
  SUBSCRIPTION_EXTENDED_EMAIL_JOB,
  SUBSCRIPTION_REDUCED_EMAIL_JOB,
  PUSH_NOTIFICATION_JOB,
} from '../../src/lib/queue.js'
import { formatEmailDate } from '../../src/lib/email-templates.js'
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

// When an admin moves the end date of a running plan EARLIER, the member is told their plan was reduced, in the
// inbox, as a push and by email, instead of the "Access extended" message an extension sends.

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

describe('shortening a running plan (extend with an earlier date)', () => {
  it('tells the member their plan was reduced, and to which date', async () => {
    const newEnd = daysFromNow(20)
    const res = await extend(member.subscriptionIds[0]!, newEnd)

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({ reduced: true, validUntil: newEnd, isActive: true })

    // The new end date is what counts.
    const active = await prisma.subscription.findMany({ where: { userId: member.id, communityId: swing.id, isActive: true } })
    expect(active.map(s => dateOnly(s.validUntil!))).toEqual([newEnd])

    // Inbox: one row, a reduction, for this community, with the new date in it.
    const rows = await inboxOf(member.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'subscription-reduced',
      communityId: swing.id,
      title: 'Plan duration reduced',
      message: `Your Swing Traders plan has been reduced. It now ends on ${formatEmailDate(newEnd)}.`,
      data: { type: 'subscription', id: swing.id, communityId: swing.id, event: 'reduced' },
    })

    // Push, and an email with both dates.
    expect(jobsNamed(PUSH_NOTIFICATION_JOB)).toEqual([
      expect.objectContaining({ userIds: [member.id], title: 'Plan duration reduced' }),
    ])
    const [email] = jobsNamed(SUBSCRIPTION_REDUCED_EMAIL_JOB) as { toEmail: string; communityName: string; validTill: string; previousValidTill: string }[]
    expect(email).toMatchObject({ toEmail: 'anita@example.com', name: 'Anita Rao', communityName: 'Swing Traders' })
    expect(dateOnly(email!.validTill)).toBe(newEnd)
    expect(dateOnly(email!.previousValidTill)).toBe(daysFromNow(60))
  })

  it('does not also say "Access extended"', async () => {
    await extend(member.subscriptionIds[0]!, daysFromNow(20))

    expect((await inboxOf(member.id)).map(n => n.type)).not.toContain('subscription-extended')
    expect(jobsNamed(SUBSCRIPTION_EXTENDED_EMAIL_JOB)).toHaveLength(0)
  })

  it('still sends the inbox notification and push when the member has no email', async () => {
    const noEmail = await createMobileMember({ email: null, subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    await extend(noEmail.subscriptionIds[0]!, daysFromNow(20))

    expect((await inboxOf(noEmail.id)).map(n => n.type)).toEqual(['subscription-reduced'])
    expect(jobsNamed(SUBSCRIPTION_REDUCED_EMAIL_JOB)).toHaveLength(0)
  })

  it('tells them each time it happens', async () => {
    await extend(member.subscriptionIds[0]!, daysFromNow(40))
    const second = await prisma.subscription.findFirstOrThrow({ where: { userId: member.id, isActive: true } })
    await extend(second.id, daysFromNow(10))

    const rows = await inboxOf(member.id)
    expect(rows.map(n => n.type)).toEqual(['subscription-reduced', 'subscription-reduced'])
    expect(rows[1]!.message).toContain(formatEmailDate(daysFromNow(10)))
  })
})

describe('what is not a reduction', () => {
  it('a later date is an extension, with the usual message', async () => {
    const res = await extend(member.subscriptionIds[0]!, daysFromNow(120))

    expect(res.body.data.reduced).toBe(false)
    expect((await inboxOf(member.id)).map(n => n.type)).toEqual(['subscription-extended'])
    expect(jobsNamed(SUBSCRIPTION_EXTENDED_EMAIL_JOB)).toHaveLength(1)
    expect(jobsNamed(SUBSCRIPTION_REDUCED_EMAIL_JOB)).toHaveLength(0)
  })

  it('the same end date is not a reduction either', async () => {
    const res = await extend(member.subscriptionIds[0]!, daysFromNow(60))

    expect(res.body.data.reduced).toBe(false)
    expect((await inboxOf(member.id)).map(n => n.type)).toEqual(['subscription-extended'])
  })

  it('renewing a plan that had already expired, even to a date before its old end, is a renewal', async () => {
    const expired = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-10), isActive: false }],
    })
    const res = await extend(expired.subscriptionIds[0]!, daysFromNow(15))

    expect(res.body.data.reduced).toBe(false)
    expect((await inboxOf(expired.id)).map(n => n.type)).toEqual(['subscription-extended'])
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

    expect(res.body.data.reduced).toBe(false)
    expect((await inboxOf(both.id)).map(n => n.type)).toEqual(['subscription-extended'])
  })
})

describe('shortening a plan through an import (overwrite)', () => {
  const importOverwrite = (validUntil: string) =>
    request(app)
      .post('/api/v1/admin/import-json')
      .set('Authorization', admin.auth)
      .send({
        strategy: 'overwrite',
        rows: [{ name: member.name, phone: member.phone, email: '', service: 'Swing Traders', payment: 1000, valid: validUntil }],
      })

  it('tells the member when the sheet moves their end date earlier', async () => {
    const res = await importOverwrite(daysFromNow(15))

    expect(res.status).toBe(200)
    expect(res.body.data.updated).toBe(1)
    const rows = await inboxOf(member.id)
    expect(rows.map(n => n.type)).toEqual(['subscription-reduced'])
    expect(rows[0]!.message).toContain(formatEmailDate(daysFromNow(15)))
    expect(jobsNamed(SUBSCRIPTION_REDUCED_EMAIL_JOB)).toHaveLength(1)
  })

  it('says nothing when the sheet moves it later', async () => {
    await importOverwrite(daysFromNow(150))
    expect(await inboxOf(member.id)).toHaveLength(0)
    expect(jobsNamed(SUBSCRIPTION_REDUCED_EMAIL_JOB)).toHaveLength(0)
  })
})
