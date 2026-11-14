import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

const mailer = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('../../src/lib/mailer.js', () => mailer)
vi.mock('../../src/lib/minio.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/minio.js')>()),
  generateInvoiceDownloadUrl: vi.fn(),
  uploadInvoicePdf: vi.fn(),
}))
// Webhook deliveries are signed by Razorpay; here every one counts as genuine.
vi.mock('../../src/lib/razorpay.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/razorpay.js')>()
  return { ...actual, verifyWebhookSignature: () => true, getRazorpayClient: () => ({ payments: { fetch: async () => ({ method: 'upi' }) } }) }
})

import { createApp } from '../../src/app.js'
import { notificationsQueue } from '../../src/lib/queue.js'
import { PaymentsService } from '../../src/modules/payments/payments.service.js'
import { ServicePaymentsService } from '../../src/modules/services/services.payments.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, createServiceRequest, type TestAdmin } from '../helpers/fixtures.js'

// The admin Transactions screen: every payment for communities and services, with its invoice, plus the attempts that
// failed and the payments that reached Razorpay but could not be applied.

const app = createApp()
const get = (admin: TestAdmin, path: string) => request(app).get(`/api/v1/admin/transactions${path}`).set('Authorization', admin.auth)

let boss: TestAdmin
let swingAdmin: TestAdmin
let swing: { id: string }
let options: { id: string }
let member: { id: string; name: string }
let quarterly: { id: string }
let yearly: { id: string }
let optionsPlan: { id: string }
let seq = 0

const at = (iso: string) => new Date(iso)

async function planOrder(over: { communityId?: string; planId?: string; status?: string; at?: Date; amount?: number; userId?: string; flagReason?: string } = {}) {
  seq += 1
  const status = over.status ?? 'paid'
  return prisma.planOrder.create({
    data: {
      userId: over.userId ?? member.id,
      communityId: over.communityId ?? swing.id,
      planId: over.planId ?? quarterly.id,
      razorpayOrderId: `order_tx_${seq}`,
      razorpayPaymentId: status === 'paid' || status === 'flagged' ? `pay_tx_${seq}` : null,
      amount: over.amount ?? 5999,
      status,
      flagReason: over.flagReason ?? null,
      ...(over.at ? { createdAt: over.at, updatedAt: over.at } : {}),
    },
  })
}

async function receiptFor(orderId: string, number: string) {
  return prisma.planReceipt.create({
    data: { planOrderId: orderId, userId: member.id, number, financialYear: '2026-27', sequence: seq, seller: {}, buyer: {}, description: 'Plan', amount: 5999 },
  })
}

/** A quoted service request with an order, ready to be paid. */
async function quotedRequest(title: string, total = 2360) {
  const req = await createServiceRequest({ userId: member.id, title, status: 'quote_sent' })
  const quote = await prisma.serviceQuote.create({
    data: {
      requestId: req.id, version: 1, baseAmount: total, gstRatePercent: 0, gstAmount: 0, totalAmount: total,
      expiresAt: new Date(Date.now() + 86_400_000), status: 'active', billing: { name: member.name, stateCode: '06' }, createdBy: boss.id,
    },
  })
  seq += 1
  const order = await prisma.razorpayOrder.create({
    data: { razorpayOrderId: `order_svc_tx_${seq}`, purpose: 'service_quote', referenceId: quote.id, userId: member.id, amount: total, status: 'created' },
  })
  return { req, quote, orderId: order.razorpayOrderId }
}

const webhook = (event: string, payment: Record<string, unknown>, id = `evt_${++seq}`) =>
  new ServicePaymentsService(prisma).handleWebhook(Buffer.from(JSON.stringify({ event, payload: { payment: { entity: payment } } })), 'sig', id)

const billing = () =>
  prisma.billingSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', legalName: 'Finskool21', addressLine: 'C9', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: '06ABCDE1234F1Z4', sacCode: '998399' },
    update: { legalName: 'Finskool21', addressLine: 'C9', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: '06ABCDE1234F1Z4', sacCode: '998399' },
  })

beforeEach(async () => {
  vi.mocked(notificationsQueue.add).mockReset()
  vi.mocked(notificationsQueue.add).mockResolvedValue({ id: 'job' } as never)
  seq = 0
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true })
  swing = await createCommunity(boss.id, { name: 'Swing Community' })
  options = await createCommunity(boss.id, { name: 'Intraday Community' })
  swingAdmin = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id] })
  member = await createMobileMember({ name: 'Aman Verma', email: 'aman@example.com' })
  quarterly = await prisma.plan.create({ data: { communityId: swing.id, name: 'Quarterly', durationMonths: 3, price: 5999 } })
  yearly = await prisma.plan.create({ data: { communityId: swing.id, name: 'Yearly', durationMonths: 12, price: 11999 } })
  optionsPlan = await prisma.plan.create({ data: { communityId: options.id, name: 'Monthly', durationMonths: 1, price: 1499 } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('what counts as a transaction', () => {
  it('lists paid plan orders with their invoice, and leaves out orders that were only started', async () => {
    const paid = await planOrder({ at: at('2026-11-13T04:54:00Z') })
    await receiptFor(paid.id, 'RCPT/2026-27/0001')
    await planOrder({ status: 'created' })

    const res = await get(boss, '')
    expect(res.status).toBe(200)
    expect(res.body.data.total).toBe(1)
    expect(res.body.data.items[0]).toMatchObject({
      kind: 'community',
      status: 'paid',
      amount: 5999,
      member: { name: 'Aman Verma', email: 'aman@example.com' },
      paidFor: { id: swing.id, name: 'Swing Community' },
      planMonths: 3,
      paymentId: `pay_tx_1`,
      occurredAt: '2026-11-13T04:54:00.000Z',
      invoice: { number: 'RCPT/2026-27/0001', downloadPath: expect.stringContaining('/admin/receipts/') },
    })
  })

  it('records a failed plan payment from the webhook, and keeps it after the member retries and pays', async () => {
    const order = await planOrder({ status: 'created' })
    await webhook('payment.failed', { id: 'pay_failed_1', order_id: order.razorpayOrderId, amount: 599900, method: 'upi', error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment declined by bank' })

    let res = await get(boss, '')
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0]).toMatchObject({ status: 'failed', paymentId: 'pay_failed_1', method: 'upi', reason: 'Payment declined by bank', invoice: null, amount: 5999 })

    // The same event delivered twice is one row.
    await webhook('payment.failed', { id: 'pay_failed_1', order_id: order.razorpayOrderId, amount: 599900 })
    // The member retries on the same order and pays.
    await new PaymentsService(prisma).settlePlanOrder(order.id, 'pay_ok_1')
    res = await get(boss, '')
    expect(res.body.data.items.map((i: { status: string }) => i.status).sort()).toEqual(['failed', 'paid'])
  })

  it('flags a plan payment of the wrong amount instead of granting it, and a later correct payment still works', async () => {
    const order = await planOrder({ status: 'created', amount: 5999 })
    await webhook('payment.captured', { id: 'pay_short', order_id: order.razorpayOrderId, amount: 100 })

    const res = await get(boss, '?status=flagged')
    expect(res.body.data.items).toHaveLength(1)
    expect(res.body.data.items[0]).toMatchObject({ status: 'flagged', reason: 'The amount paid did not match the order', paymentId: 'pay_short' })
    expect(await prisma.subscription.count()).toBe(0)

    await new PaymentsService(prisma).settlePlanOrder(order.id, 'pay_full')
    const after = await prisma.planOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(after).toMatchObject({ status: 'paid', flagReason: null })
  })

  it('flags a payment from a member who was blocked, and still refuses to grant it', async () => {
    const order = await planOrder({ status: 'created' })
    await prisma.communityBlock.create({ data: { userId: member.id, communityId: swing.id, blockedBy: boss.id, reason: 'abuse' } as never })

    await expect(new PaymentsService(prisma).settlePlanOrder(order.id, 'pay_blocked')).rejects.toThrow()
    const res = await get(boss, '?status=flagged')
    expect(res.body.data.items[0]).toMatchObject({ status: 'flagged', reason: 'The member is blocked from this community' })
  })

  it('lists a paid service with its invoice number, a failed attempt, and a payment that could not be applied', async () => {
    await billing()
    const ok = await quotedRequest('Portfolio Analysis')
    await new ServicePaymentsService(prisma).settle({ razorpayOrderId: ok.orderId, razorpayPaymentId: 'pay_svc_ok', amountPaise: null, source: 'verify' })

    const declined = await quotedRequest('Intelligent Model Portfolio', 25000)
    await webhook('payment.failed', { id: 'pay_svc_failed', order_id: declined.orderId, amount: 2500000, method: 'card', error_description: 'Card expired' })

    const odd = await quotedRequest('Stock Review')
    await new ServicePaymentsService(prisma).settle({ razorpayOrderId: odd.orderId, razorpayPaymentId: 'pay_svc_odd', amountPaise: 100, source: 'webhook' })

    const res = await get(boss, '?type=services')
    const byPayment = Object.fromEntries(res.body.data.items.map((i: { paymentId: string }) => [i.paymentId, i]))
    expect(byPayment['pay_svc_ok']).toMatchObject({
      status: 'paid',
      paidFor: { name: 'Portfolio Analysis' },
      reference: `SR-${ok.req.number} · Quote 1`,
      invoice: { number: expect.stringMatching(/^FS\/\d{4}-\d{2}\/0001$/), downloadPath: `/api/v1/admin/services/${ok.req.id}/invoice` },
      requestId: ok.req.id,
    })
    expect(byPayment['pay_svc_failed']).toMatchObject({ status: 'failed', method: 'card', reason: 'Card expired', amount: 25000, invoice: null })
    expect(byPayment['pay_svc_odd']).toMatchObject({ status: 'flagged', reason: 'The amount paid did not match the order' })
  })

  it('flags a service payment that was applied but could not be invoiced, until an admin resolves the review', async () => {
    // No seller billing details: the money is in and the request is paid, but there is no invoice.
    const q = await quotedRequest('Portfolio Analysis')
    await new ServicePaymentsService(prisma).settle({ razorpayOrderId: q.orderId, razorpayPaymentId: 'pay_noinv', amountPaise: null, source: 'verify' })
    let res = await get(boss, '')
    expect(res.body.data.items[0]).toMatchObject({ status: 'flagged', reason: 'Paid, but no invoice could be issued' })

    await prisma.serviceRequest.update({ where: { id: q.req.id }, data: { requiresReview: false } })
    res = await get(boss, '')
    expect(res.body.data.items[0].status).toBe('paid')
  })
})

describe('listing', () => {
  async function seed() {
    // 5 paid + 2 failed communities spread over days, 1 paid service.
    const days = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-08', '2026-11-12']
    for (const [i, d] of days.entries()) {
      const o = await planOrder({ at: at(`${d}T06:00:00Z`), planId: i % 2 ? yearly.id : quarterly.id, amount: 1000 + i })
      await receiptFor(o.id, `RCPT/2026-27/000${i + 1}`)
    }
    const other = await planOrder({ communityId: options.id, planId: optionsPlan.id, at: at('2026-11-10T06:00:00Z'), amount: 1499 })
    await receiptFor(other.id, 'RCPT/2026-27/0006')
    const failedOrder = await planOrder({ status: 'created' })
    await prisma.planPaymentFailure.create({ data: { planOrderId: failedOrder.id, razorpayPaymentId: 'pay_f1', amount: 5999, createdAt: at('2026-11-09T06:00:00Z') } })
    await billing()
    const svc = await quotedRequest('Portfolio Analysis')
    await new ServicePaymentsService(prisma).settle({ razorpayOrderId: svc.orderId, razorpayPaymentId: 'pay_svc', amountPaise: null, source: 'verify' })
  }

  it('pages newest first and reports the total, the page count and the tab counts', async () => {
    await seed()
    const p1 = (await get(boss, '?pageSize=3&page=1')).body.data
    expect(p1).toMatchObject({ page: 1, pageSize: 3, total: 8, totalPages: 3, counts: { all: 8, community: 7, service: 1 } })
    const p3 = (await get(boss, '?pageSize=3&page=3')).body.data
    expect(p3.items).toHaveLength(2)

    const all = (await get(boss, '?pageSize=100')).body.data.items as { occurredAt: string; id: string }[]
    const times = all.map(i => i.occurredAt)
    expect(times).toEqual([...times].sort().reverse())
    expect(new Set(all.map(i => i.id)).size).toBe(8)
    // Pages do not overlap.
    const stitched = [...p1.items, ...(await get(boss, '?pageSize=3&page=2')).body.data.items, ...p3.items].map((i: { id: string }) => i.id)
    expect(stitched).toEqual(all.map(i => i.id))
  })

  it('filters by type, status, community, plan length and date, and the tabs ignore only the type', async () => {
    await seed()
    const q = async (qs: string) => (await get(boss, `?pageSize=100&${qs}`)).body.data

    expect((await q('type=communities')).total).toBe(7)
    expect((await q('type=services')).total).toBe(1)
    expect((await q('status=failed')).total).toBe(1)
    expect((await q(`paidFor=${options.id}`)).total).toBe(1)
    expect((await q('plan=12')).total).toBe(2)
    expect((await q('plan=1')).total).toBe(1)
    expect((await q('from=2026-11-05&to=2026-11-10&type=communities')).total).toBe(4) // 5th, 8th, 9th (failed), 10th

    const tabs = (await q('status=paid&type=services')).counts
    expect(tabs).toEqual({ all: 6 + 1 - 0, community: 6, service: 1 }) // paid only: 6 community + 1 service
  })

  it('treats the dates as IST days: a payment at 23:30 IST on the 12th belongs to the 12th', async () => {
    const lateIst = await planOrder({ at: at('2026-11-12T18:00:00Z') }) // 23:30 IST on the 12th
    await planOrder({ at: at('2026-11-12T19:00:00Z') }) // 00:30 IST on the 13th
    const on12 = (await get(boss, '?from=2026-11-12&to=2026-11-12')).body.data
    expect(on12.items.map((i: { id: string }) => i.id)).toEqual([`plan:${lateIst.id}`])
  })

  it('searches member name, email, invoice number and payment id, and treats % and _ literally', async () => {
    const o = await planOrder()
    await receiptFor(o.id, 'RCPT/2026-27/0042')
    expect((await get(boss, '?search=aman')).body.data.total).toBe(1)
    expect((await get(boss, '?search=example.com')).body.data.total).toBe(1)
    expect((await get(boss, '?search=0042')).body.data.total).toBe(1)
    expect((await get(boss, '?search=pay_tx_1')).body.data.total).toBe(1)
    expect((await get(boss, '?search=%25')).body.data.total).toBe(0)
    expect((await get(boss, '?search=zzz')).body.data.total).toBe(0)
  })

  it('rejects bad input', async () => {
    expect((await get(boss, '?status=refunded')).status).toBe(400)
    expect((await get(boss, '?from=13-11-2026')).status).toBe(400)
    expect((await get(boss, '?from=2026-11-10&to=2026-11-01')).status).toBe(400)
    expect((await get(boss, '?pageSize=1000')).status).toBe(400)
    expect((await get(boss, '?page=0')).status).toBe(400)
  })

  it('needs an admin', async () => {
    expect((await request(app).get('/api/v1/admin/transactions')).status).toBe(401)
  })
})

describe('who sees what', () => {
  it("shows an admin only their communities' payments, but every service payment", async () => {
    await planOrder({ communityId: swing.id })
    await planOrder({ communityId: options.id, planId: optionsPlan.id })
    await billing()
    const svc = await quotedRequest('Portfolio Analysis')
    await new ServicePaymentsService(prisma).settle({ razorpayOrderId: svc.orderId, razorpayPaymentId: 'pay_svc_scope', amountPaise: null, source: 'verify' })
    const failedOrder = await planOrder({ communityId: options.id, planId: optionsPlan.id, status: 'created' })
    await prisma.planPaymentFailure.create({ data: { planOrderId: failedOrder.id, razorpayPaymentId: 'pay_f_scope', amount: 1499 } })

    const mine = (await get(swingAdmin, '?pageSize=100')).body.data
    expect(mine.counts).toEqual({ all: 2, community: 1, service: 1 })
    expect(mine.items.map((i: { paidFor: { name: string } }) => i.paidFor.name).sort()).toEqual(['Portfolio Analysis', 'Swing Community'])
    expect((await get(boss, '?pageSize=100')).body.data.total).toBe(4)

    const stats = (await get(swingAdmin, '/stats')).body.data
    expect(stats.failed.count).toBe(0)
    expect((await get(boss, '/stats')).body.data.failed.count).toBe(1)

    const filters = (await get(swingAdmin, '/filters')).body.data
    expect(filters.communities).toEqual([{ id: swing.id, name: 'Swing Community' }])
    expect(filters.planMonths).toEqual([3, 12])
  })
})

describe('KPIs', () => {
  it('totals what was collected, this IST month, the success rate, and what failed or is flagged', async () => {
    const now = new Date()
    const lastMonth = new Date(now.getTime() - 40 * 86_400_000)
    await planOrder({ amount: 1000 })
    await planOrder({ amount: 2000 })
    await planOrder({ amount: 4000, at: lastMonth })
    await planOrder({ status: 'flagged', flagReason: 'amount_mismatch', amount: 500 })
    const failedOrder = await planOrder({ status: 'created' })
    await prisma.planPaymentFailure.create({ data: { planOrderId: failedOrder.id, razorpayPaymentId: 'pay_kpi_f', amount: 5999 } })

    const stats = (await get(boss, '/stats')).body.data
    expect(stats.totalCollected).toEqual({ amount: 7000, payments: 3 }) // flagged money is not collected
    expect(stats.thisMonth).toMatchObject({ amount: 3000, payments: 2 })
    expect(stats.successful).toEqual({ count: 3, ratePercent: 75 }) // 3 paid of 4 attempts
    expect(stats.failed.count).toBe(1)
    expect(stats.flagged.count).toBe(1)
  })

  it('has no success rate before any payment', async () => {
    const stats = (await get(boss, '/stats')).body.data
    expect(stats).toMatchObject({ totalCollected: { amount: 0, payments: 0 }, successful: { count: 0, ratePercent: null } })
  })
})

describe('CSV export', () => {
  it('exports the filtered rows, and defuses text a spreadsheet would run as a formula', async () => {
    const evil = await createMobileMember({ name: '=HYPERLINK("http://x")', email: 'evil@example.com' })
    const o = await planOrder({ userId: evil.id, at: at('2026-11-13T04:54:00Z') })
    await receiptFor(o.id, 'RCPT/2026-27/0007')
    await planOrder({ status: 'paid', at: at('2026-10-01T04:54:00Z') })

    const res = await get(boss, '/export?from=2026-11-01')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="transactions-\d{4}-\d{2}-\d{2}\.csv"/)
    const lines = res.text.replace(/^﻿/, '').split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('"Invoice","Payment ID","Order ID","Member","Email","Type","Paid for","Plan","Amount (INR)","Status","Method","Reason","Date (IST)"')
    expect(lines[1]).toContain('"RCPT/2026-27/0007"')
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(lines[1]).toContain('"2026-11-13 10:24"')
    expect(lines[1]).toContain('"5999.00","Paid"')
  })
})
