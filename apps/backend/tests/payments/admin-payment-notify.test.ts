import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Keep the PDF work and Razorpay out of it: a purchase issues a receipt / invoice in the background.
const mailer = vi.hoisted(() => ({ sendMail: vi.fn() }))
vi.mock('../../src/lib/mailer.js', () => mailer)
vi.mock('../../src/lib/minio.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/minio.js')>()),
  generateInvoiceDownloadUrl: vi.fn(),
  uploadInvoicePdf: vi.fn(),
}))
vi.mock('../../src/lib/razorpay.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/razorpay.js')>()
  return { ...actual, getRazorpayClient: () => ({ payments: { fetch: async () => ({ method: 'upi' }) } }) }
})

import { ADMIN_PAYMENT_EMAIL_JOB, notificationsQueue } from '../../src/lib/queue.js'
import type { AdminPaymentEmailJobPayload } from '../../src/lib/queue.js'
import { notifyAdminsOfPayment } from '../../src/lib/admin-payment-notify.js'
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js'
import { PaymentsService } from '../../src/modules/payments/payments.service.js'
import { ServicePaymentsService } from '../../src/modules/services/services.payments.js'
import { NotificationType } from '../../src/modules/notifications/notifications.dto.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, createServiceRequest } from '../helpers/fixtures.js'

// When a member buys a plan or pays for a service, the admins are told twice: an inbox row (and live event) for the
// admin web, and an email. A plan purchase tells the admins who manage that community; a service is global, so it
// tells every admin.

const queueAdd = vi.mocked(notificationsQueue.add)

/** The admin-payment emails queued so far. */
const adminEmails = () =>
  queueAdd.mock.calls.filter(([name]) => name === ADMIN_PAYMENT_EMAIL_JOB).map(([, data]) => data as AdminPaymentEmailJobPayload)

const inboxOf = (userId: string, type?: string) =>
  prisma.notification.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: 'asc' } })

let swing: { id: string }
let options: { id: string }
let plan: { id: string }
let member: { id: string; name: string }
let boss: { id: string }
let swingAdmin: { id: string }
let optionsAdmin: { id: string }
let orderSeq = 0

async function openOrder(over: Record<string, unknown> = {}) {
  orderSeq += 1
  return prisma.planOrder.create({
    data: {
      userId: member.id,
      communityId: swing.id,
      planId: plan.id,
      razorpayOrderId: `order_notify_${orderSeq}`,
      amount: 5000,
      status: 'created',
      ...over,
    } as never,
  })
}

const buy = (orderId: string, paymentId = `pay_notify_${orderSeq}`) => new PaymentsService(prisma).settlePlanOrder(orderId, paymentId)

beforeEach(async () => {
  queueAdd.mockReset()
  queueAdd.mockResolvedValue({ id: 'job' } as never)
  mailer.sendMail.mockReset()
  orderSeq = 0
  await resetDb()
  boss = await createAdmin({ isSuperAdmin: true, name: 'Boss Admin', email: 'boss@finskool.test' })
  const owner = boss
  swing = await createCommunity(owner.id, { name: 'Swing Alpha' })
  options = await createCommunity(owner.id, { name: 'Options Lab' })
  swingAdmin = await createAdmin({ isSuperAdmin: false, communityIds: [swing.id], name: 'Swing Admin', email: 'swing@finskool.test' })
  optionsAdmin = await createAdmin({ isSuperAdmin: false, communityIds: [options.id], name: 'Options Admin', email: 'options@finskool.test' })
  member = await createMobileMember({ name: 'Aman Verma' })
  plan = await prisma.plan.create({ data: { communityId: swing.id, name: '3 Months', durationMonths: 3, price: 5000 } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('a member buys a plan', () => {
  it('puts it in the inbox of every super admin and of the admins of that community, and no one else', async () => {
    const order = await openOrder()
    const result = await buy(order.id)

    const [forBoss, forSwingAdmin, forOptionsAdmin] = await Promise.all([inboxOf(boss.id), inboxOf(swingAdmin.id), inboxOf(optionsAdmin.id)])
    expect(forOptionsAdmin).toEqual([])
    for (const rows of [forBoss, forSwingAdmin]) {
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        type: NotificationType.AdminSubscriptionPaid,
        sourceId: result.subscriptionId,
        communityId: swing.id,
        title: 'New subscription',
        message: 'Aman Verma bought 3 Months in Swing Alpha for ₹5,000.',
        isRead: false,
        data: { type: 'member', id: member.id, communityId: swing.id, event: 'paid' },
      })
    }
  })

  it('does not tell the member as an admin: they keep only their own "added" notification', async () => {
    await buy((await openOrder()).id)
    const own = await inboxOf(member.id)
    expect(own.map(n => n.type)).toEqual([NotificationType.CommunityAdded])
  })

  it('emails each of those admins, with what was bought, the amount and a link to the member', async () => {
    const order = await openOrder()
    await buy(order.id)

    const emails = adminEmails()
    expect(emails.map(e => e.adminEmail).sort()).toEqual(['boss@finskool.test', 'swing@finskool.test'])
    expect(emails.find(e => e.adminEmail === 'swing@finskool.test')).toMatchObject({
      adminName: 'Swing Admin',
      kind: 'paid',
      memberName: 'Aman Verma',
      item: 'Swing Alpha · 3 Months',
      amount: '₹5,000',
      path: `/admin/members/${member.id}`,
    })
    expect(new Date(emails[0]!.paidOn).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('says "renewed" when the member already had the plan', async () => {
    await buy((await openOrder()).id)
    queueAdd.mockClear()
    await buy((await openOrder()).id)

    const rows = await inboxOf(swingAdmin.id, NotificationType.AdminSubscriptionPaid)
    expect(rows).toHaveLength(2) // one per purchase
    expect(rows[1]).toMatchObject({ title: 'Subscription renewed', message: 'Aman Verma renewed 3 Months in Swing Alpha for ₹5,000.' })
    expect(adminEmails().every(e => e.item === 'Swing Alpha · 3 Months (renewal)')).toBe(true)
  })

  it('charges what was paid, not what the plan costs now', async () => {
    const order = await openOrder({ amount: 5900 }) // the plan price (5000) plus GST at the time of the order
    await buy(order.id)
    const [row] = await inboxOf(boss.id)
    expect(row!.message).toContain('₹5,900')
    expect(adminEmails()[0]!.amount).toBe('₹5,900')
  })

  it('tells them once when the same order is confirmed twice (the app and the webhook)', async () => {
    const order = await openOrder()
    await buy(order.id, 'pay_same')
    await buy(order.id, 'pay_same')

    expect(await inboxOf(boss.id, NotificationType.AdminSubscriptionPaid)).toHaveLength(1)
    expect(adminEmails()).toHaveLength(2)
  })

  it('still sends the inbox row, and the purchase still succeeds, when the email cannot be queued', async () => {
    queueAdd.mockImplementation((async (name: string) => {
      if (name === ADMIN_PAYMENT_EMAIL_JOB) throw new Error('queue down')
      return { id: 'job' }
    }) as never)

    const result = await buy((await openOrder()).id)

    expect(result.isActive).toBe(true)
    expect(await inboxOf(boss.id, NotificationType.AdminSubscriptionPaid)).toHaveLength(1)
    expect(await inboxOf(swingAdmin.id, NotificationType.AdminSubscriptionPaid)).toHaveLength(1)
  })

  it('gives an admin with no email address the inbox row and no email', async () => {
    await prisma.user.update({ where: { id: swingAdmin.id }, data: { email: null } })
    await buy((await openOrder()).id)

    expect(await inboxOf(swingAdmin.id, NotificationType.AdminSubscriptionPaid)).toHaveLength(1)
    expect(adminEmails().map(e => e.adminEmail)).toEqual(['boss@finskool.test'])
  })

  it('does not tell a deleted admin', async () => {
    await prisma.user.update({ where: { id: swingAdmin.id }, data: { deletedAt: new Date() } })
    await buy((await openOrder()).id)

    expect(await inboxOf(swingAdmin.id)).toEqual([])
    expect(adminEmails().map(e => e.adminEmail)).toEqual(['boss@finskool.test'])
  })
})

describe('sending one payment to admins', () => {
  const inbox = (adminIds: string[], sourceId: string) => ({
    db: prisma,
    adminIds,
    type: NotificationType.AdminSubscriptionPaid,
    sourceId,
    communityId: null,
    title: 'T',
    message: 'M',
    data: { type: 'member', id: 'x' },
  })
  const details = { kind: 'paid' as const, memberName: 'A', item: 'I', amount: '₹1', paidOn: new Date().toISOString(), path: '/admin/members' }
  const SOURCE = '00000000-0000-4000-8000-000000000001'

  it('emails an admin only the first time it tells them about the same event', async () => {
    await notifyAdminsOfPayment(inbox([boss.id, swingAdmin.id], SOURCE), details)
    expect(adminEmails()).toHaveLength(2)

    queueAdd.mockClear()
    await notifyAdminsOfPayment(inbox([boss.id, swingAdmin.id], SOURCE), details)
    expect(adminEmails()).toEqual([])

    // A new admin joining the audience later is told; the others are not told again.
    await notifyAdminsOfPayment(inbox([boss.id, optionsAdmin.id], SOURCE), details)
    expect(adminEmails().map(e => e.adminEmail)).toEqual(['options@finskool.test'])
  })

  it('does nothing when there is no one to tell', async () => {
    await notifyAdminsOfPayment(inbox([], SOURCE), details)
    expect(queueAdd).not.toHaveBeenCalled()
  })
})

describe('a member pays for a service', () => {
  let request: { id: string; number: number }
  let orderId: string
  let quoteId: string

  async function quoted(opts: { billingConfigured: boolean }) {
    if (opts.billingConfigured) {
      await prisma.billingSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', legalName: 'Finskool21', addressLine: 'C9 803, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: '06ABCDE1234F1Z4', sacCode: '998399' },
        update: { legalName: 'Finskool21', addressLine: 'C9 803, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: '06ABCDE1234F1Z4', sacCode: '998399' },
      })
    }
    request = await createServiceRequest({ userId: member.id, title: 'Portfolio Review', status: 'quote_sent' })
    const quote = await prisma.serviceQuote.create({
      data: {
        requestId: request.id,
        version: 1,
        baseAmount: 2000,
        gstRatePercent: 18,
        gstAmount: 360,
        totalAmount: 2360,
        expiresAt: new Date(Date.now() + 86_400_000),
        status: 'active',
        billing: { name: 'Aman Verma', stateCode: '06' },
        createdBy: boss.id,
      },
    })
    quoteId = quote.id
    const order = await prisma.razorpayOrder.create({
      data: { razorpayOrderId: `order_svc_${request.id.slice(0, 8)}`, purpose: 'service_quote', referenceId: quote.id, userId: member.id, amount: 2360, status: 'created' },
    })
    orderId = order.razorpayOrderId
  }

  const pay = (source: 'verify' | 'webhook' = 'verify') =>
    new ServicePaymentsService(prisma).settle({ razorpayOrderId: orderId, razorpayPaymentId: `pay_${orderId}`, amountPaise: null, source })

  it('puts it in every admin\'s inbox and emails every admin', async () => {
    await quoted({ billingConfigured: true })
    expect((await pay()).outcome).toBe('settled')

    for (const admin of [boss, swingAdmin, optionsAdmin]) {
      const rows = await inboxOf(admin.id, NotificationType.AdminServicePaid)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.message).toBe(`Aman Verma paid ₹2,360 for Portfolio Review (SR-${request.number}).`)
    }
    const emails = adminEmails()
    expect(emails.map(e => e.adminEmail).sort()).toEqual(['boss@finskool.test', 'options@finskool.test', 'swing@finskool.test'])
    expect(emails[0]).toMatchObject({
      kind: 'paid',
      memberName: 'Aman Verma',
      item: `Portfolio Review (SR-${request.number})`,
      amount: '₹2,360',
      path: `/admin/services/${request.id}`,
    })
  })

  it('emails once when the app and the webhook both report the payment', async () => {
    await quoted({ billingConfigured: true })
    await pay('verify')
    await pay('webhook')

    expect(await inboxOf(boss.id, NotificationType.AdminServicePaid)).toHaveLength(1)
    expect(adminEmails()).toHaveLength(3)
  })

  it('emails a payment that needs a manual look, pointing at the review page', async () => {
    // No seller billing details: the money is in but no invoice can be issued, so an admin has to step in.
    await quoted({ billingConfigured: false })
    expect((await pay()).outcome).toBe('settled')

    const rows = await inboxOf(boss.id, NotificationType.AdminPaymentFlagged)
    expect(rows).toHaveLength(1)
    expect(await inboxOf(boss.id, NotificationType.AdminServicePaid)).toEqual([])
    const emails = adminEmails()
    expect(emails).toHaveLength(3)
    expect(emails[0]).toMatchObject({ kind: 'review', path: `/admin/transactions?status=flagged&request=${request.id}`, amount: '₹2,360' })
    void quoteId
  })
})

describe('the email an admin receives', () => {
  const base: AdminPaymentEmailJobPayload = {
    adminEmail: 'boss@finskool.test',
    adminName: 'Boss Admin',
    kind: 'paid',
    memberName: 'Aman Verma',
    item: 'Swing Alpha · 3 Months',
    amount: '₹5,000',
    paidOn: '2026-11-07T08:00:00.000Z',
    path: '/admin/members/abc',
  }
  const send = async (over: Partial<AdminPaymentEmailJobPayload> = {}) => {
    await new NotificationsService(prisma).sendAdminPaymentEmail({ ...base, ...over })
    return mailer.sendMail.mock.calls[0]![0] as { to: string; subject: string; html: string }
  }

  it('goes to that admin, says who paid what, and links to the page', async () => {
    const mail = await send()

    expect(mail.to).toBe('boss@finskool.test')
    expect(mail.subject).toBe('Aman Verma paid ₹5,000')
    expect(mail.html).toContain('Hi Boss,')
    expect(mail.html).toContain('Swing Alpha · 3 Months')
    expect(mail.html).toContain('₹5,000')
    expect(mail.html).toContain('7 Nov 2026')
    expect(mail.html).toContain('/admin/members/abc')
    expect(mail.html).toContain('Payment received')
    expect(mail.html).not.toMatch(/\{\w+\}/) // no placeholder left unfilled
  })

  it('asks for a review when the payment could not be applied', async () => {
    const mail = await send({ kind: 'review', path: '/admin/payment-flags?request=r1' })

    expect(mail.subject).toBe('Payment needs review: Aman Verma paid ₹5,000')
    expect(mail.html).toContain('could not be applied automatically')
    expect(mail.html).toContain('Review payment')
    expect(mail.html).toContain('/admin/payment-flags?request=r1')
    expect(mail.html).not.toMatch(/\{\w+\}/)
  })

  it('cannot be made to carry markup by a member\'s name', async () => {
    const mail = await send({ memberName: '<script>alert(1)</script>' })
    expect(mail.html).not.toContain('<script>alert(1)</script>')
    expect(mail.html).toContain('&lt;script&gt;')
  })
})
