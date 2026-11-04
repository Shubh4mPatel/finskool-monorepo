import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

// Stand in for Razorpay: the invoice asks it how a plan was paid.
const razorpay = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../src/lib/razorpay.js', () => ({
  getRazorpayClient: () => ({ payments: { fetch: razorpay.fetch } }),
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}))

import { createApp } from '../../src/app.js'
import { describePayment, maskUpiId } from '../../src/lib/payment-details.js'
import { issuePlanReceipt, renderReceiptPdf } from '../../src/lib/plan-receipt.js'
import { buildReceiptView, formatDay, formatDayAndTime, formatRupees } from '../../src/lib/receipt-pdf.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, type TestAdmin } from '../helpers/fixtures.js'

// The invoice a member gets for a plan: what it says (buildReceiptView), that it draws (renderReceiptPdf), what is
// kept when it is issued (issuePlanReceipt), and the seller details it prints (Settings > Billing). Plan prices carry
// no GST, so there is no tax split anywhere on it.

const app = createApp()

// ─── How it was paid ────────────────────────────────────────────────────────

describe('masking and describing a payment', () => {
  it.each([
    ['aman.verma@okhdfcbank', 'aman.v•••@okhdfcbank'],
    ['raj12@upi', 'ra•••@upi'],
    ['abc@ybl', 'a•••@ybl'],
    ['averyveryverylonghandle@icici', 'averyv•••@icici'],
    ['9876543210', '987654•••'],
  ])('hides most of the UPI id %s', (vpa, masked) => {
    expect(maskUpiId(vpa)).toBe(masked)
  })

  it('names the method and keeps only what is safe to print', () => {
    expect(describePayment({ method: 'upi', vpa: 'aman.verma@okhdfcbank', created_at: 1_793_000_000, order_id: 'order_1' })).toEqual({
      method: 'UPI',
      detail: 'aman.v•••@okhdfcbank',
      paidAt: new Date(1_793_000_000 * 1000).toISOString(),
      orderId: 'order_1',
    })
    expect(describePayment({ method: 'card', card: { network: 'VISA', last4: '4242' } })).toMatchObject({ method: 'Card', detail: 'Visa ••••4242' })
    expect(describePayment({ method: 'netbanking', bank: 'hdfc' })).toMatchObject({ method: 'Netbanking', detail: 'HDFC' })
    expect(describePayment({ method: 'wallet', wallet: 'paytm' })).toMatchObject({ method: 'Wallet', detail: 'Paytm' })
  })

  it('copes with a method it does not know and with a record that says little', () => {
    expect(describePayment({ method: 'cardless_emi' })).toMatchObject({ method: 'Cardless EMI', detail: null, paidAt: null, orderId: null })
    expect(describePayment({ method: 'something_new' })).toMatchObject({ method: 'Something new' })
    expect(describePayment({})).toMatchObject({ method: 'Online payment', detail: null })
  })

  it('never prints a whole UPI id or card number', () => {
    const upi = describePayment({ method: 'upi', vpa: 'aman.verma@okhdfcbank' })
    expect(upi.detail).not.toContain('verma')
    const card = describePayment({ method: 'card', card: { network: 'mastercard', last4: '1111' } })
    expect(card.detail).toBe('Mastercard ••••1111')
  })
})

// ─── What it says ───────────────────────────────────────────────────────────

const SELLER = {
  legalName: 'Finskool21',
  address: 'C9 803, Srs Residency, Sector 88, Faridabad, Haryana, 121002',
  gstin: '06ABCDE1234F1Z4',
  contactEmail: 'support@finskool21.com',
  contactPhone: '+91 92113 09647',
  footerNote: null,
  proprietorName: 'Ritesh Kumar',
  pan: 'ABCDE1234F',
  sebiRegistrationNo: 'INH000022987',
  website: 'finskool21.com',
  sacCode: '998399',
}

function receipt(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    planOrderId: 'o1',
    userId: 'u1',
    number: 'RCPT/2026-27/0184',
    financialYear: '2026-27',
    sequence: 184,
    issuedAt: new Date('2026-10-30T05:12:00Z'), // 10:42 in India
    seller: SELLER,
    buyer: { name: 'Aman Verma', email: 'aman.verma@example.com', phone: '+91 98765 43210' },
    description: 'Swing Alpha Community - Half-yearly (6 months)',
    amount: 7000,
    currency: 'INR',
    razorpayPaymentId: 'pay_PqR8sT2uV9wXyZ',
    periodStart: new Date('2026-10-30'),
    periodEnd: new Date('2027-04-29'),
    payment: { method: 'UPI', detail: 'aman.v•••@okhdfcbank', paidAt: '2026-10-30T05:12:00.000Z', orderId: 'order_PqR7aB3cD4eF' },
    pdfObjectKey: null,
    createdAt: new Date(),
    ...over,
  } as never
}

describe('formatting', () => {
  it('writes dates and times on the Indian clock, with the month spelled the same on every machine', () => {
    expect(formatDay(new Date('2026-10-30T05:12:00Z'))).toBe('30 Oct 2026')
    expect(formatDay(new Date('2026-09-05T20:00:00Z'))).toBe('6 Sep 2026') // already the 6th in India
    expect(formatDayAndTime(new Date('2026-10-30T05:12:00Z'))).toBe('30 Oct 2026, 10:42 am')
    expect(formatDayAndTime(new Date('2026-10-30T10:05:00Z'))).toBe('30 Oct 2026, 3:35 pm')
    expect(formatDayAndTime(new Date('2026-10-30T18:35:00Z'))).toBe('31 Oct 2026, 12:05 am')
  })

  it('writes rupees with the Indian grouping', () => {
    expect(formatRupees(7000)).toBe('₹7,000.00')
    expect(formatRupees('1234567.5')).toBe('₹12,34,567.50')
  })
})

describe('what the invoice says', () => {
  it('carries the content of the design: who, what, for when, how it was paid, and who sold it', () => {
    const v = buildReceiptView(receipt())
    expect(v).toMatchObject({
      brand: 'Finskool21',
      tagline: 'SEBI Registered Research Analyst · INH000022987',
      amount: '₹7,000.00',
      paidOn: '30 Oct 2026',
      billedTo: { name: 'Aman Verma', lines: ['aman.verma@example.com', '+91 98765 43210'] },
      details: [
        ['Invoice no.', 'RCPT/2026-27/0184'],
        ['Invoice date', '30 Oct 2026'],
      ],
      item: { title: 'Swing Alpha Community - Half-yearly (6 months)', sac: '998399', period: ['30 Oct 2026 –', '29 Apr 2027'], amount: '₹7,000.00' },
      total: '₹7,000.00',
      totalInWords: 'Rupees Seven Thousand Only',
    })
    expect(v.payment).toEqual([
      { label: 'Payment method', value: 'UPI', detail: 'aman.v•••@okhdfcbank' },
      { label: 'Paid through', value: 'Razorpay' },
      { label: 'Paid on', value: '30 Oct 2026, 10:42 am' },
      { label: 'Payment ID', value: 'pay_PqR8sT2uV9wXyZ' },
      { label: 'Order ID', value: 'order_PqR7aB3cD4eF' },
      { label: 'Status', value: 'Successful', ok: true },
    ])
    expect(v.accessNote).toBe(
      'Access is active from 30 Oct 2026 to 29 Apr 2027 and does not renew automatically. For billing questions, write to support@finskool21.com with your invoice number.',
    )
    expect(v.footer.left).toEqual({
      name: 'Finskool21',
      rest: ' · Proprietor: Ritesh Kumar',
      lines: ['C9 803, Srs Residency, Sector 88, Faridabad, Haryana, 121002', 'GSTIN 06ABCDE1234F1Z4 · PAN ABCDE1234F'],
    })
    expect(v.footer.right).toEqual(['support@finskool21.com', '+91 92113 09647', 'finskool21.com'])
    expect(v.footer.fineprint[0]).toMatch(/^Investment in securities market are subject to market risks/)
    expect(v.footer.fineprint.at(-1)).toBe('This is a computer-generated invoice and does not require a signature. Grievances: support@finskool21.com · scores.sebi.gov.in')
  })

  it('has no tax split: plan prices carry no GST, so the total is what was paid', () => {
    const printed = JSON.stringify(buildReceiptView(receipt()))
    for (const word of ['CGST', 'SGST', 'IGST', 'Taxable', 'inclusive of GST', 'Place of supply']) expect(printed).not.toContain(word)
    expect(buildReceiptView(receipt({ amount: 1180 })).total).toBe('₹1,180.00')
  })

  it('leaves out what it does not know, instead of printing blanks', () => {
    const bare = buildReceiptView(
      receipt({
        seller: { legalName: 'Finskool21', address: null, gstin: null, contactEmail: null, contactPhone: null, footerNote: null },
        buyer: { name: 'Priya Shah', email: null, phone: '+91 91234 56789' },
        periodStart: null,
        periodEnd: null,
        payment: null,
        razorpayPaymentId: null,
      }),
    )
    expect(bare.tagline).toBeNull()
    expect(bare.billedTo.lines).toEqual(['+91 91234 56789'])
    expect(bare.item.period).toBeNull()
    expect(bare.item.sac).toBeNull()
    expect(bare.accessNote).toBeNull()
    expect(bare.payment.map(c => c.label)).toEqual(['Paid through', 'Paid on', 'Status'])
    expect(bare.footer.left).toEqual({ name: 'Finskool21', rest: null, lines: [] })
    expect(bare.footer.right).toEqual([])
    // No SEBI number set, so no SEBI wording either.
    expect(bare.footer.fineprint).toEqual(['This is a computer-generated invoice and does not require a signature.'])
  })

  it('shows the time of the payment when Razorpay gave it, and the time it was issued when not', () => {
    expect(buildReceiptView(receipt({ payment: { method: 'UPI', detail: null, paidAt: '2026-10-30T08:30:00.000Z', orderId: null } })).payment.find(c => c.label === 'Paid on')?.value).toBe('30 Oct 2026, 2:00 pm')
    expect(buildReceiptView(receipt({ payment: null })).payment.find(c => c.label === 'Paid on')?.value).toBe('30 Oct 2026, 10:42 am')
  })

  it('keeps the seller\'s own footer note', () => {
    const v = buildReceiptView(receipt({ seller: { ...SELLER, footerNote: 'Thank you for trusting us.' } }))
    expect(v.footer.fineprint).toContain('Thank you for trusting us.')
  })
})

// ─── What is drawn ──────────────────────────────────────────────────────────

describe('the PDF', () => {
  const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length

  it('is one A4 page with the Inter font embedded, which is what draws the rupee sign', async () => {
    const pdf = await renderReceiptPdf(receipt())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pages(pdf)).toBe(1)
    const raw = pdf.toString('latin1')
    expect(raw).toContain('Inter-Regular')
    expect(raw).toContain('Inter-SemiBold')
    expect(raw).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/)
  })

  it('still draws when most of it is unknown', async () => {
    const pdf = await renderReceiptPdf(
      receipt({ seller: { legalName: 'Finskool21' }, buyer: { name: 'Priya Shah', email: null, phone: '+91 91234 56789' }, periodStart: null, periodEnd: null, payment: null, razorpayPaymentId: null }),
    )
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pages(pdf)).toBe(1)
  })

  it('keeps long names and descriptions on the one page', async () => {
    const pdf = await renderReceiptPdf(
      receipt({
        description: 'An Extremely Long Community Name That Goes On And On - Half-yearly premium research plan (6 months)',
        buyer: { name: 'A Member With A Very Long Name Indeed Ramachandran Venkataraghavan', email: 'a.very.long.email.address.indeed@some-long-company-domain.example.com', phone: '+91 98765 43210' },
      }),
    )
    expect(pages(pdf)).toBe(1)
  })
})

// ─── What is kept when it is issued ─────────────────────────────────────────

let boss: TestAdmin
let community: { id: string }
let member: { id: string }
let plan: { id: string }
let orderSeq = 0

async function paidOrder(over: Record<string, unknown> = {}) {
  orderSeq += 1
  return prisma.planOrder.create({
    data: {
      userId: member.id,
      communityId: community.id,
      planId: plan.id,
      razorpayOrderId: `order_test_${orderSeq}`,
      razorpayPaymentId: `pay_test_${orderSeq}`,
      amount: 7000,
      status: 'paid',
      ...over,
    } as never,
  })
}

describe('issuing it', () => {
  beforeEach(async () => {
    razorpay.fetch.mockReset()
    orderSeq = 0
    await resetDb()
    boss = await createAdmin({ isSuperAdmin: true })
    community = await createCommunity(boss.id, { name: 'Swing Alpha' })
    member = await createMobileMember({ name: 'Aman Verma' })
    plan = await prisma.plan.create({ data: { communityId: community.id, name: 'Half-yearly', durationMonths: 6, price: 7000 } })
    await prisma.billingSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', legalName: 'Finskool21', addressLine: 'C9 803, Srs Residency, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: SELLER.gstin, sacCode: '998399', contactEmail: SELLER.contactEmail, contactPhone: SELLER.contactPhone, proprietorName: 'Ritesh Kumar', pan: 'ABCDE1234F', sebiRegistrationNo: 'INH000022987', website: 'finskool21.com' },
      update: { legalName: 'Finskool21', addressLine: 'C9 803, Srs Residency, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: SELLER.gstin, sacCode: '998399', contactEmail: SELLER.contactEmail, contactPhone: SELLER.contactPhone, proprietorName: 'Ritesh Kumar', pan: 'ABCDE1234F', sebiRegistrationNo: 'INH000022987', website: 'finskool21.com' },
    })
  })

  it('keeps the days of access, how it was paid and the seller as they were', async () => {
    razorpay.fetch.mockResolvedValue({ method: 'upi', vpa: 'aman.verma@okhdfcbank', created_at: 1_793_336_520, order_id: 'order_from_razorpay' })
    const order = await paidOrder()
    const issued = await issuePlanReceipt(prisma, order.id, { start: new Date('2026-10-30'), end: new Date('2027-04-29') })

    expect(razorpay.fetch).toHaveBeenCalledWith(order.razorpayPaymentId)
    expect(issued.number).toMatch(/^RCPT\/\d{4}-\d{2}\/0001$/)
    expect(issued.periodStart?.toISOString().slice(0, 10)).toBe('2026-10-30')
    expect(issued.periodEnd?.toISOString().slice(0, 10)).toBe('2027-04-29')
    expect(issued.payment).toMatchObject({ method: 'UPI', detail: 'aman.v•••@okhdfcbank', orderId: 'order_from_razorpay' })
    expect(issued.seller).toMatchObject({
      legalName: 'Finskool21',
      proprietorName: 'Ritesh Kumar',
      pan: 'ABCDE1234F',
      sebiRegistrationNo: 'INH000022987',
      website: 'finskool21.com',
      sacCode: '998399',
      address: 'C9 803, Srs Residency, Sector 88, Faridabad, 121002',
    })
    expect(issued.description).toBe('Swing Alpha - Half-yearly (6 months)')
    expect(Number(issued.amount)).toBe(7000)

    // The invoice is drawn from what was kept, and later changes to the settings do not touch it.
    await prisma.billingSettings.update({ where: { id: 'default' }, data: { proprietorName: 'Someone Else' } })
    const pdf = await renderReceiptPdf(issued)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buildReceiptView(issued).footer.left.rest).toBe(' · Proprietor: Ritesh Kumar')
  })

  it('is still issued when Razorpay cannot say how it was paid, and keeps the order id it already had', async () => {
    razorpay.fetch.mockRejectedValue(new Error('Razorpay is down'))
    const order = await paidOrder()
    const issued = await issuePlanReceipt(prisma, order.id, { start: new Date('2026-10-30'), end: new Date('2027-04-29') })

    expect(issued.payment).toEqual({ method: null, detail: null, paidAt: null, orderId: order.razorpayOrderId })
    const view = buildReceiptView(issued)
    expect(view.payment.map(c => c.label)).toEqual(['Paid through', 'Paid on', 'Payment ID', 'Order ID', 'Status'])
  })

  it('works out the days of access from the subscription when the caller did not give them', async () => {
    razorpay.fetch.mockRejectedValue(new Error('no lookup'))
    const subscription = await prisma.subscription.create({
      data: { userId: member.id, communityId: community.id, planId: plan.id, payment: 7000, paidOn: new Date('2026-10-30'), validUntil: new Date('2027-04-30'), isActive: true },
    })
    const order = await paidOrder({ subscriptionId: subscription.id })
    const issued = await issuePlanReceipt(prisma, order.id)
    expect(issued.periodStart?.toISOString().slice(0, 10)).toBe('2026-10-30')
    expect(issued.periodEnd?.toISOString().slice(0, 10)).toBe('2027-04-30')
  })

  it('issues one invoice per order, and asks Razorpay only once', async () => {
    razorpay.fetch.mockResolvedValue({ method: 'card', card: { network: 'visa', last4: '4242' } })
    const order = await paidOrder()
    const first = await issuePlanReceipt(prisma, order.id, { start: new Date('2026-10-30'), end: new Date('2027-04-29') })
    const again = await issuePlanReceipt(prisma, order.id, { start: new Date('2030-01-01'), end: new Date('2030-06-30') })
    expect(again.id).toBe(first.id)
    expect(again.number).toBe(first.number)
    expect(again.periodStart?.toISOString().slice(0, 10)).toBe('2026-10-30')
    expect(razorpay.fetch).toHaveBeenCalledTimes(1)
  })

  it('numbers them one after another', async () => {
    razorpay.fetch.mockRejectedValue(new Error('no lookup'))
    const numbers: string[] = []
    for (let i = 0; i < 3; i++) numbers.push((await issuePlanReceipt(prisma, (await paidOrder()).id)).number.split('/').at(-1)!)
    expect(numbers).toEqual(['0001', '0002', '0003'])
  })
})

// ─── The seller details it prints ───────────────────────────────────────────

describe('Settings > Billing', () => {
  let root: TestAdmin
  const base = {
    legalName: 'Finskool21',
    addressLine: 'C9 803, Srs Residency, Sector 88',
    city: 'Faridabad',
    pincode: '121002',
    stateCode: '06',
    gstin: '06ABCDE1234F1Z4',
    sacCode: '998399',
    defaultGstRatePercent: 18,
    defaultQuoteExpiryDays: 5,
    invoicePrefix: 'FS21',
  }
  const put = (admin: TestAdmin, body: Record<string, unknown>) => request(app).put('/api/v1/admin/services/billing-settings').set('Authorization', admin.auth).send(body)
  const get = (admin: TestAdmin) => request(app).get('/api/v1/admin/services/billing-settings').set('Authorization', admin.auth)

  beforeEach(async () => {
    await resetDb()
    root = await createAdmin({ isSuperAdmin: true })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('saves the proprietor, PAN, SEBI registration number and website, and gives them back', async () => {
    const saved = await put(root, { ...base, proprietorName: 'Ritesh Kumar', pan: 'abcde1234f', sebiRegistrationNo: 'inh000022987', website: 'finskool21.com' })
    expect(saved.status).toBe(200)
    expect(saved.body.data).toMatchObject({ proprietorName: 'Ritesh Kumar', pan: 'ABCDE1234F', sebiRegistrationNo: 'INH000022987', website: 'finskool21.com' })
    expect((await get(root)).body.data).toMatchObject({ proprietorName: 'Ritesh Kumar', pan: 'ABCDE1234F', sebiRegistrationNo: 'INH000022987', website: 'finskool21.com' })
  })

  it('they are optional, and leaving them out clears them', async () => {
    await put(root, { ...base, proprietorName: 'Ritesh Kumar', pan: 'ABCDE1234F' })
    const cleared = await put(root, base)
    expect(cleared.status).toBe(200)
    expect(cleared.body.data).toMatchObject({ proprietorName: null, pan: null, sebiRegistrationNo: null, website: null })
    // And they do not decide whether quotes can be sent.
    expect(cleared.body.data.isConfigured).toBe(true)
  })

  it.each([
    ['a PAN that is not a PAN', { pan: 'ABC123' }, 'pan'],
    ['a SEBI number that is not one', { sebiRegistrationNo: '12345' }, 'sebiRegistrationNo'],
    ['a website with spaces', { website: 'finskool 21.com' }, 'website'],
    ['a proprietor name that is too long', { proprietorName: 'x'.repeat(151) }, 'proprietorName'],
  ])('rejects %s', async (_label, extra, field) => {
    const res = await put(root, { ...base, ...extra })
    expect(res.status).toBe(422)
    expect(res.body.errors).toHaveProperty(field)
  })

  it('only a super admin can change them', async () => {
    const scoped = await createAdmin({ isSuperAdmin: false })
    expect((await put(scoped, { ...base, pan: 'ABCDE1234F' })).status).toBe(403)
  })
})
