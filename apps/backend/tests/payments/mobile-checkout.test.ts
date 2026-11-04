import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHmac } from 'crypto'
import { createApp } from '../../src/app.js'
import redis from '../../src/lib/redis.js'
import { env } from '../../src/config/env.js'
import {
  prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow,
  type TestMobileMember,
} from '../helpers/fixtures.js'

// Buying a plan inside the mobile app's webview:
//   POST /payments/checkout-sessions (app, mobile session) -> checkoutUrl with a one-time token in its fragment
//   POST /payments/checkout/exchange (page) -> burns the token, returns the order + a session token
//   POST /payments/checkout/verify   (page, Bearer session token) -> grants the plan
//   POST /payments/webhooks/razorpay -> grants the plan too if the page never verified

let orderSeq = 0
vi.mock('../../src/lib/razorpay.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/razorpay.js')>()
  return { ...actual, getRazorpayClient: () => ({ orders: { create: async () => ({ id: `order_test_${++orderSeq}` }) } }) }
})

const app = createApp()
const WEBHOOK_SECRET = 'whsec_test'

let member: TestMobileMember
let communityId: string
let planId: string

const sign = (orderId: string, paymentId: string) =>
  createHmac('sha256', env.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex')

const startCheckout = (m = member, body: object = { communityId, planId }) =>
  request(app).post('/api/v1/payments/checkout-sessions').set('Cookie', mobileCookie(m)).send(body)

const tokenOf = (res: request.Response) => (res.body.data.checkoutUrl as string).split('#t=')[1]!

const exchange = (token: string) => request(app).post('/api/v1/payments/checkout/exchange').send({ token })

const verify = (sessionToken: string, paymentId: string, signature: string) =>
  request(app).post('/api/v1/payments/checkout/verify').set('Authorization', `Bearer ${sessionToken}`)
    .send({ razorpayPaymentId: paymentId, razorpaySignature: signature })

/** Start a checkout and open it, as the app and then the webview page would. */
async function openCheckout() {
  const started = await startCheckout()
  const opened = await exchange(tokenOf(started))
  return { started, opened, sessionToken: opened.body.data.sessionToken as string, orderId: opened.body.data.orderId as string }
}

function webhook(event: string, orderId: string, paymentId: string, amountPaise: number, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount: amountPaise, currency: 'INR', method: 'upi' } } },
  })
  const signature = createHmac('sha256', secret).update(body).digest('hex')
  return request(app)
    .post('/api/v1/payments/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', signature)
    .set('X-Razorpay-Event-Id', `evt_${Math.random()}`)
    .send(body)
}

beforeEach(async () => {
  await resetDb()
  const razorpay = env.razorpay as { keySecret: string; webhookSecret: string }
  razorpay.keySecret = 'test-key-secret'
  razorpay.webhookSecret = WEBHOOK_SECRET

  // A working in-memory Redis for the few commands the checkout uses (the shared mock resolves everything to null).
  const store = new Map<string, string>()
  vi.mocked(redis.set).mockImplementation((async (k: string, v: string) => { store.set(k, v); return 'OK' }) as never)
  vi.mocked(redis.get).mockImplementation((async (k: string) => store.get(k) ?? null) as never)
  vi.mocked(redis.getdel).mockImplementation((async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v }) as never)
  vi.mocked(redis.incr).mockImplementation((async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n }) as never)
  vi.mocked(redis.expire).mockImplementation((async () => 1) as never)

  const admin = await createAdmin()
  const community = await createCommunity(admin.id)
  communityId = community.id
  const plan = await prisma.plan.create({ data: { communityId, name: '3 Month', durationMonths: 3, price: 999 } })
  planId = plan.id
  member = await createMobileMember()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /payments/checkout-sessions', () => {
  it('gives the app a checkout URL with a one-time token in the fragment, and never the session id', async () => {
    const res = await startCheckout()

    expect(res.status).toBe(201)
    const url = res.body.data.checkoutUrl as string
    expect(url).toMatch(/\/pay\/checkout#t=[\w-]{20,}$/)
    expect(url).not.toContain(member.sessionId!)
    expect(url.split('#')[0]).not.toContain('?')
  })

  it('needs a mobile session', async () => {
    const res = await request(app).post('/api/v1/payments/checkout-sessions').send({ communityId, planId })
    expect(res.status).toBe(401)
  })

  it('rejects a plan that belongs to another community, and the free community', async () => {
    const admin = await createAdmin()
    const other = await createCommunity(admin.id)
    expect((await startCheckout(member, { communityId: other.id, planId })).status).toBe(404)

    const free = await createCommunity(admin.id, { isFree: true })
    expect((await startCheckout(member, { communityId: free.id, planId })).status).toBe(400)
  })

  it('reuses the unpaid order of a recent tap instead of making a new one', async () => {
    await startCheckout()
    await startCheckout()
    expect(await prisma.planOrder.count({ where: { userId: member.id } })).toBe(1)
  })

  it('limits how many checkouts a member can start per hour', async () => {
    for (let i = 0; i < 10; i++) expect((await startCheckout()).status).toBe(201)
    expect((await startCheckout()).status).toBe(429)
  })
})

describe('POST /payments/checkout/exchange', () => {
  it('trades the token for the order to pay, priced by the server', async () => {
    const { opened } = await openCheckout()

    expect(opened.status).toBe(200)
    expect(opened.body.data).toMatchObject({ status: 'created', amount: 99900, currency: 'INR', planName: '3 Month', durationMonths: 3 })
    expect(opened.body.data.sessionToken).toBeTruthy()
  })

  it('works once: the same token a second time is refused', async () => {
    const token = tokenOf(await startCheckout())
    expect((await exchange(token)).status).toBe(200)
    expect((await exchange(token)).status).toBe(401)
  })

  it('refuses a made-up or too-short token', async () => {
    expect((await exchange('x'.repeat(43))).status).toBe(401)
    expect((await exchange('short')).status).toBe(400)
  })

  it('stores only a hash of the token', async () => {
    const token = tokenOf(await startCheckout())
    const keys = vi.mocked(redis.set).mock.calls.map(c => String(c[0]))
    expect(keys.every(k => !k.includes(token))).toBe(true)
  })
})

describe('POST /payments/checkout/verify', () => {
  it('grants the plan for a good signature, for the member who started the checkout', async () => {
    const { sessionToken, orderId } = await openCheckout()

    const res = await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ communityId, planId, isActive: true, payment: 999 })
    const subs = await prisma.subscription.findMany({ where: { userId: member.id, communityId } })
    expect(subs).toHaveLength(1)
    expect((await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status).toBe('paid')
  })

  it('needs the session token', async () => {
    const { orderId } = await openCheckout()
    const none = await request(app).post('/api/v1/payments/checkout/verify').send({ razorpayPaymentId: 'pay_1', razorpaySignature: sign(orderId, 'pay_1') })
    expect(none.status).toBe(401)
    expect((await verify('not-a-session', 'pay_1', sign(orderId, 'pay_1'))).status).toBe(401)
  })

  it('refuses a bad signature and leaves the order payable', async () => {
    const { sessionToken, orderId } = await openCheckout()

    const bad = await verify(sessionToken, 'pay_1', 'deadbeef'.repeat(8))
    expect(bad.status).toBe(400)
    expect((await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status).toBe('created')

    // The member's real payment still goes through afterwards.
    expect((await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))).status).toBe(200)
  })

  it('cannot use a payment signed for a different order', async () => {
    const { sessionToken } = await openCheckout()
    expect((await verify(sessionToken, 'pay_1', sign('order_someone_else', 'pay_1'))).status).toBe(400)
    expect(await prisma.subscription.count({ where: { userId: member.id } })).toBe(0)
  })

  it('answers a repeat of the same payment with the same result, and grants only once', async () => {
    const { sessionToken, orderId } = await openCheckout()
    const first = await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))
    const again = await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))

    expect(again.status).toBe(200)
    expect(again.body.data).toEqual(first.body.data)
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId } })).toBe(1)
  })

  it('refuses a second, different payment on an order that is already paid', async () => {
    const { sessionToken, orderId } = await openCheckout()
    await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))
    expect((await verify(sessionToken, 'pay_2', sign(orderId, 'pay_2'))).status).toBe(409)
  })

  it('still pays an order an earlier version had marked failed on a bad signature', async () => {
    const { sessionToken, orderId } = await openCheckout()
    await prisma.planOrder.update({ where: { razorpayOrderId: orderId }, data: { status: 'failed', razorpayPaymentId: 'pay_junk' } })
    expect((await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))).status).toBe(200)
  })

  it('a session reaches only its own order', async () => {
    const mine = await openCheckout()
    const other = await createMobileMember()
    const theirs = await (async () => {
      const started = await startCheckout(other)
      const opened = await exchange(tokenOf(started))
      return { sessionToken: opened.body.data.sessionToken as string, orderId: opened.body.data.orderId as string }
    })()

    // My session with their payment: signature is for their order, not mine.
    expect((await verify(mine.sessionToken, 'pay_9', sign(theirs.orderId, 'pay_9'))).status).toBe(400)
    expect(await prisma.subscription.count({ where: { userId: other.id } })).toBe(0)
  })
})

describe('GET /payments/checkout/status', () => {
  it('shows created, then paid with the new end date', async () => {
    const { sessionToken, orderId } = await openCheckout()
    const status = () => request(app).get('/api/v1/payments/checkout/status').set('Authorization', `Bearer ${sessionToken}`)

    expect((await status()).body.data).toEqual({ status: 'created' })
    await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))
    const paid = await status()
    expect(paid.body.data.status).toBe('paid')
    expect(paid.body.data.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('needs the session token', async () => {
    expect((await request(app).get('/api/v1/payments/checkout/status')).status).toBe(401)
  })
})

describe('Razorpay webhook for a plan purchase', () => {
  it('grants the plan when the page never got to verify', async () => {
    const { orderId } = await openCheckout()

    const res = await webhook('payment.captured', orderId, 'pay_1', 99900)

    expect(res.status).toBe(200)
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId, isActive: true } })).toBe(1)
    expect((await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status).toBe('paid')
  })

  it('and the page, arriving later, gets the same result without a second grant', async () => {
    const { sessionToken, orderId } = await openCheckout()
    await webhook('order.paid', orderId, 'pay_1', 99900)

    const res = await verify(sessionToken, 'pay_1', sign(orderId, 'pay_1'))

    expect(res.status).toBe(200)
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId } })).toBe(1)
  })

  it('order.paid and payment.captured for one payment grant once', async () => {
    const { orderId } = await openCheckout()
    await webhook('order.paid', orderId, 'pay_1', 99900)
    await webhook('payment.captured', orderId, 'pay_1', 99900)
    expect(await prisma.subscription.count({ where: { userId: member.id, communityId } })).toBe(1)
  })

  it('does not grant when the amount paid is not the price', async () => {
    const { orderId } = await openCheckout()
    const res = await webhook('payment.captured', orderId, 'pay_1', 100)

    expect(res.status).toBe(200) // acknowledged, so Razorpay stops retrying
    expect(await prisma.subscription.count({ where: { userId: member.id } })).toBe(0)
  })

  it('does not mark the order failed on payment.failed — the member can retry', async () => {
    const { orderId } = await openCheckout()
    await webhook('payment.failed', orderId, 'pay_1', 99900)
    expect((await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status).toBe('created')
  })

  it('rejects a wrongly signed call', async () => {
    const { orderId } = await openCheckout()
    const res = await webhook('payment.captured', orderId, 'pay_1', 99900, 'wrong-secret')
    expect(res.status).toBe(400)
    expect(await prisma.subscription.count({ where: { userId: member.id } })).toBe(0)
  })

  it('extends an active subscription from its current end date', async () => {
    const sub = await prisma.subscription.create({
      data: { userId: member.id, communityId, payment: 999, paidOn: new Date(), validUntil: new Date(daysFromNow(30)), isActive: true },
    })
    const { orderId } = await openCheckout()
    await webhook('payment.captured', orderId, 'pay_1', 99900)

    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).isActive).toBe(false)
    const current = await prisma.subscription.findFirstOrThrow({ where: { userId: member.id, communityId, isActive: true } })
    expect(current.validUntil.getTime()).toBeGreaterThan(new Date(daysFromNow(30)).getTime())
  })
})

// A plan's price is before GST. Once the seller's billing details are complete, GST is added on top and Razorpay is
// asked for the total; the webhook accepts only that total, and the member gets a GST tax invoice.
describe('GST on top of the plan price', () => {
  beforeEach(async () => {
    Object.assign(env.razorpay, { keyId: 'rzp_test_gst' })
    await prisma.plan.update({ where: { id: planId }, data: { price: 999 } })
    await prisma.billingSettings.create({
      data: { id: 'default', legalName: 'Finskool21', addressLine: 'C9 803, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: '06ABCDE1234F1Z4', sacCode: '998399', defaultGstRatePercent: 18 },
    })
  })

  it('shows the checkout page the price, the GST and the total to pay', async () => {
    const { opened } = await openCheckout()
    expect(opened.body.data).toMatchObject({ amount: 117882, baseAmount: 99900, gstAmount: 17982, gstRatePercent: 18 })
  })

  it('grants the plan for a payment of the total, records what was paid, and issues a GST tax invoice', async () => {
    const { orderId } = await openCheckout()
    const res = await webhook('payment.captured', orderId, 'pay_gst_1', 117882)

    expect(res.status).toBe(200)
    const subscription = await prisma.subscription.findFirstOrThrow({ where: { userId: member.id, communityId, isActive: true } })
    expect(Number(subscription.payment)).toBe(1178.82)

    const receipt = await prisma.planReceipt.findFirstOrThrow({ where: { userId: member.id } })
    expect(receipt.number).toMatch(/^FS\/\d{4}-\d{2}\/0001$/)
    expect([receipt.amount, receipt.taxableValue, receipt.cgst, receipt.sgst, receipt.igst, receipt.gstRatePercent].map(Number)).toEqual([1178.82, 999, 89.91, 89.91, 0, 18])
  })

  it('does not grant for a payment of only the price before GST', async () => {
    const { orderId } = await openCheckout()
    await webhook('payment.captured', orderId, 'pay_gst_2', 99900)

    expect(await prisma.subscription.count({ where: { userId: member.id, communityId } })).toBe(0)
    expect((await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: orderId } })).status).toBe('created')
  })

  it('the member\'s page verifies a payment of the total the same way', async () => {
    const { sessionToken, orderId } = await openCheckout()
    const res = await verify(sessionToken, 'pay_gst_3', sign(orderId, 'pay_gst_3'))

    expect(res.status).toBe(200)
    expect(res.body.data.payment).toBe(1178.82)
  })
})

// The payment page shows the member what they are buying: the community and what they get with it.
describe('what the checkout shows about the community', () => {
  beforeEach(async () => {
    Object.assign(env.razorpay, { keyId: 'rzp_test_info' })
    await prisma.community.update({
      where: { id: communityId },
      data: {
        name: 'Swing Alpha',
        description: 'Swing trade ideas with entries, targets and exits.\nBacked by research.',
        type: 'Short Term Investment',
        tags: ['swing', 'equity'],
        coverImageUrl: 'https://files.test/cover.png',
        badgeUrl: 'https://files.test/badge.png',
        whatsIncluded: ['Daily trade ideas', 'Live Q&A', 'Performance tracker'],
      },
    })
  })

  it('sends who it is and what the member gets, next to the plan and the price', async () => {
    const { opened } = await openCheckout()
    expect(opened.body.data).toMatchObject({ communityName: 'Swing Alpha', planName: '3 Month', durationMonths: 3 })
    expect(opened.body.data.community).toEqual({
      name: 'Swing Alpha',
      description: 'Swing trade ideas with entries, targets and exits.\nBacked by research.',
      type: 'Short Term Investment',
      tags: ['swing', 'equity'],
      coverImageUrl: 'https://files.test/cover.png',
      badgeUrl: 'https://files.test/badge.png',
      whatsIncluded: ['Daily trade ideas', 'Live Q&A', 'Performance tracker'],
      memberCount: 0,
    })
  })

  it('counts each member with access once, and not the ones whose access has run out', async () => {
    const active = await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(30) }] })
    await prisma.subscription.create({ data: { userId: active.id, communityId, payment: 100, paidOn: new Date(daysFromNow(-60)), validUntil: new Date(daysFromNow(10)), isActive: true } })
    await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(5) }] })
    await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(-5) }] })
    await createMobileMember({ subscriptions: [{ communityId, validUntil: daysFromNow(30), isActive: false }] })

    const { opened } = await openCheckout()
    expect(opened.body.data.community.memberCount).toBe(2)
  })

  it('copes with a community that has no description, cover or points', async () => {
    await prisma.community.update({ where: { id: communityId }, data: { description: null, type: null, tags: [], coverImageUrl: null, badgeUrl: null, whatsIncluded: [] } })
    const { opened } = await openCheckout()
    expect(opened.body.data.community).toMatchObject({ description: null, type: null, tags: [], coverImageUrl: null, badgeUrl: null, whatsIncluded: [] })
  })
})
