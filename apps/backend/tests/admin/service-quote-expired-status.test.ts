import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createMobileMember, createServiceRequest, type TestAdmin } from '../helpers/fixtures.js'

// A quote that was sent and ran out unpaid puts the request back to `requested`. The Enquiries screen used to read that
// as "Requested" and the dashboard as "Replied", hiding that a quote had gone out. Both now say "Quote expired".

const app = createApp()
let boss: TestAdmin
let memberId: string

beforeEach(async () => {
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  memberId = (await createMobileMember({})).id
})

afterAll(async () => {
  await prisma.$disconnect()
})

const quoteFor = (requestId: string, over: Record<string, unknown> = {}) =>
  prisma.serviceQuote.create({
    data: { requestId, version: 1, baseAmount: 1000, gstRatePercent: 0, gstAmount: 0, totalAmount: 1000, expiresAt: new Date('2020-01-01'), status: 'expired', createdBy: boss.id, ...over } as never,
  })

const dashboardStatus = async (id: string) => {
  const res = await request(app).get('/api/v1/admin/dashboard/tickets').query({ limit: 20 }).set('Authorization', boss.auth)
  return (res.body.data.items as { id: string; status: { key: string; label: string } }[]).find(i => i.id === id)!.status
}
const listRow = async (id: string) => {
  const res = await request(app).get('/api/v1/admin/services').set('Authorization', boss.auth)
  return (res.body.data.items as { id: string; status: string; quoteExpired: boolean }[]).find(r => r.id === id)!
}

describe('a request whose quote expired', () => {
  it('reads "Quote expired" on the dashboard and is flagged on the Enquiries list and detail', async () => {
    const sr = await createServiceRequest({ userId: memberId, repliedBy: boss.id, status: 'requested' })
    await quoteFor(sr.id)

    expect(await dashboardStatus(sr.id)).toMatchObject({ key: 'quote_expired', label: 'Quote expired' })
    expect(await listRow(sr.id)).toMatchObject({ status: 'requested', quoteExpired: true })
    const detail = await request(app).get(`/api/v1/admin/services/${sr.id}`).set('Authorization', boss.auth)
    expect(detail.body.data).toMatchObject({ status: 'requested', quoteExpired: true })
  })

  it('also when the sweep has not recorded it yet: a "sent" request whose active quote is past its expiry', async () => {
    const sr = await createServiceRequest({ userId: memberId, repliedBy: boss.id, status: 'quote_sent' })
    await quoteFor(sr.id, { status: 'active' })

    expect(await dashboardStatus(sr.id)).toMatchObject({ key: 'quote_expired' })
    expect((await listRow(sr.id)).quoteExpired).toBe(true)
  })

  it('a live quote, a replaced one and a request with no quote keep their usual status', async () => {
    const live = await createServiceRequest({ userId: memberId, repliedBy: boss.id, status: 'quote_sent' })
    await quoteFor(live.id, { status: 'active', expiresAt: new Date('2099-01-01') })
    const noQuote = await createServiceRequest({ userId: memberId, repliedBy: boss.id, status: 'requested' })
    const replaced = await createServiceRequest({ userId: memberId, repliedBy: boss.id, status: 'quote_sent' })
    await quoteFor(replaced.id, { version: 1 })
    await quoteFor(replaced.id, { version: 2, status: 'active', expiresAt: new Date('2099-01-01') })

    expect(await dashboardStatus(live.id)).toMatchObject({ key: 'quote_sent' })
    expect(await dashboardStatus(noQuote.id)).toMatchObject({ key: 'replied' })
    expect(await dashboardStatus(replaced.id)).toMatchObject({ key: 'quote_sent' })
    expect((await listRow(live.id)).quoteExpired).toBe(false)
    expect((await listRow(noQuote.id)).quoteExpired).toBe(false)
    expect((await listRow(replaced.id)).quoteExpired).toBe(false)
  })
})
