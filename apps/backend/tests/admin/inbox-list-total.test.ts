import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, type TestAdmin } from '../helpers/fixtures.js'

// GET /api/v1/admin/tickets and /api/v1/admin/services page by cursor and also say how many rows match the
// filters in all (`total`), so the admin screens can show "Showing 1-20 of 57" and number their pages. The
// total is over the filters alone: it must not change as the cursor moves.

const app = createApp()

let boss: TestAdmin
let swing: { id: string }
let options: { id: string }
let priya: TestAdmin // scoped to Swing
let member: { id: string }
let seq = 0

/** Each row gets its own minute, so the order (newest first) is the reverse of the creation order. */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n))

async function ticket(communityId: string, over: Record<string, unknown> = {}) {
  const n = ++seq
  return prisma.ticket.create({
    data: {
      userId: member.id,
      communityId,
      category: 'other',
      type: 'issue',
      subject: `Ticket ${n}`,
      description: 'Something is wrong',
      clientRequestId: `t-${n}`,
      lastMessageAt: at(n),
      ...over,
    } as never,
  })
}

const tickets = (admin: TestAdmin, query: Record<string, string> = {}) =>
  request(app).get('/api/v1/admin/tickets').query(query).set('Authorization', admin.auth)
const services = (admin: TestAdmin, query: Record<string, string> = {}) =>
  request(app).get('/api/v1/admin/services').query(query).set('Authorization', admin.auth)

const ids = (res: request.Response) => res.body.data.items.map((i: { id: string }) => i.id)

beforeEach(async () => {
  seq = 0
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Traders' })
  options = await createCommunity(boss.id, { name: 'Options Lab' })
  priya = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  member = await createMobileMember()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /admin/tickets total', () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) await ticket(swing.id)
    for (let i = 0; i < 2; i++) await ticket(options.id)
  })

  it('counts every ticket that matches, however small the page', async () => {
    const res = await tickets(boss, { limit: '2' })
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.nextCursor).not.toBeNull()
    expect(res.body.data.total).toBe(7)
  })

  it('keeps the same total as the cursor walks the pages, and shows each ticket once', async () => {
    const seen: string[] = []
    const totals: number[] = []
    let cursor: string | null = null
    do {
      const res: request.Response = await tickets(boss, { limit: '3', ...(cursor ? { cursor } : {}) })
      seen.push(...ids(res))
      totals.push(res.body.data.total)
      cursor = res.body.data.nextCursor
    } while (cursor)
    expect(totals).toEqual([7, 7, 7])
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('follows the filters', async () => {
    await prisma.ticket.updateMany({ where: { communityId: swing.id, number: { lte: 2 } }, data: { status: 'resolved' } })
    await prisma.ticket.updateMany({ where: { communityId: options.id }, data: { category: 'payments', adminUnreadCount: 1 } })

    expect((await tickets(boss, { communityId: swing.id })).body.data.total).toBe(5)
    expect((await tickets(boss, { status: 'resolved' })).body.data.total).toBe(2)
    expect((await tickets(boss, { category: 'payments' })).body.data.total).toBe(2)
    expect((await tickets(boss, { unread: 'true' })).body.data.total).toBe(2)
    expect((await tickets(boss, { open: 'true' })).body.data.total).toBe(5)
    expect((await tickets(boss, { communityId: swing.id, category: 'payments' })).body.data.total).toBe(0)
  })

  it('counts only the communities an admin may see', async () => {
    const res = await tickets(priya)
    expect(res.body.data.total).toBe(5)
    expect(res.body.data.items).toHaveLength(5)
  })

  it('is 0 with no rows when nothing matches', async () => {
    const res = await tickets(boss, { search: 'no ticket is called this' })
    expect(res.body.data).toMatchObject({ items: [], nextCursor: null, total: 0 })
  })
})

describe('GET /admin/services total', () => {
  let service: { id: string }

  // A member can have only one open request per service, so each request comes from a member of its own.
  async function serviceRequest(over: Record<string, unknown> = {}) {
    const n = ++seq
    return prisma.serviceRequest.create({
      data: {
        userId: (await createMobileMember()).id,
        serviceId: service.id,
        needs: 'Help me with this',
        clientRequestId: `s-${n}`,
        lastMessageAt: at(n),
        ...over,
      } as never,
    })
  }

  beforeEach(async () => {
    service = await prisma.service.create({ data: { name: 'tax-filing', title: 'Tax filing', description: 'We file it', createdBy: boss.id } })
    for (let i = 0; i < 6; i++) await serviceRequest()
  })

  it('counts every request that matches, however small the page', async () => {
    const res = await services(boss, { limit: '2' })
    expect(res.status).toBe(200)
    expect(res.body.data.items).toHaveLength(2)
    expect(res.body.data.nextCursor).not.toBeNull()
    expect(res.body.data.total).toBe(6)
  })

  it('keeps the same total as the cursor walks the pages, and shows each request once', async () => {
    const seen: string[] = []
    const totals: number[] = []
    let cursor: string | null = null
    do {
      const res: request.Response = await services(boss, { limit: '4', ...(cursor ? { cursor } : {}) })
      seen.push(...ids(res))
      totals.push(res.body.data.total)
      cursor = res.body.data.nextCursor
    } while (cursor)
    expect(totals).toEqual([6, 6])
    expect(new Set(seen).size).toBe(6)
  })

  it('follows the filters, including the payment-review one the Payment flags screen uses', async () => {
    await prisma.serviceRequest.updateMany({ where: { number: { lte: 2 } }, data: { requiresReview: true } })
    await prisma.serviceRequest.updateMany({ where: { number: { gte: 5 } }, data: { status: 'closed', closedReason: 'completed' } })

    expect((await services(boss, { review: 'true' })).body.data.total).toBe(2)
    expect((await services(boss, { review: 'true', limit: '1' })).body.data.total).toBe(2)
    expect((await services(boss, { status: 'closed' })).body.data.total).toBe(2)
    expect((await services(boss, { open: 'true' })).body.data.total).toBe(4)
    expect((await services(boss, { review: 'true', status: 'closed' })).body.data.total).toBe(0)
  })

  it('is 0 with no rows when nothing matches', async () => {
    const res = await services(boss, { search: 'no request is called this' })
    expect(res.body.data).toMatchObject({ items: [], nextCursor: null, total: 0 })
  })
})
