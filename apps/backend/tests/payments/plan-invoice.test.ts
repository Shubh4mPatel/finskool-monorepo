import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

// Stand in for Razorpay: the invoice asks it how a plan was paid.
const razorpay = vi.hoisted(() => ({ fetch: vi.fn(), createOrder: vi.fn() }))
// And for the file store: signing a link needs its credentials, which the test environment does not have.
const storage = vi.hoisted(() => ({ sign: vi.fn(), upload: vi.fn() }))
vi.mock('../../src/lib/minio.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/minio.js')>()),
  generateInvoiceDownloadUrl: storage.sign,
  uploadInvoicePdf: storage.upload,
}))
vi.mock('../../src/lib/razorpay.js', () => ({
  getRazorpayClient: () => ({ payments: { fetch: razorpay.fetch }, orders: { create: razorpay.createOrder } }),
  verifyPaymentSignature: vi.fn(),
  verifyWebhookSignature: vi.fn(),
}))

import { createApp } from '../../src/app.js'
import { env } from '../../src/config/env.js'
import { describePayment, maskUpiId } from '../../src/lib/payment-details.js'
import { loadGstRules, priceWithGst } from '../../src/lib/plan-gst.js'
import { PaymentsService } from '../../src/modules/payments/payments.service.js'
import { issuePlanReceipt, renderReceiptPdf } from '../../src/lib/plan-receipt.js'
import { buildReceiptView, formatDay, formatDayAndTime, formatRupees } from '../../src/lib/receipt-pdf.js'
import { prisma, resetDb, createAdmin, createCommunity, createMobileMember, mobileCookie, daysFromNow, type TestAdmin } from '../helpers/fixtures.js'

// The invoice a member gets for a plan: what it says (buildReceiptView), that it draws (renderReceiptPdf), what is
// kept when it is issued (issuePlanReceipt), and the seller details it prints (Settings > Billing). A plan's price is
// before GST: GST is added on top, Razorpay charges the total, and the invoice shows the split. Until the seller's
// billing details are complete no GST is added, and the member gets a plain receipt with no tax lines.

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
    taxableValue: null,
    gstRatePercent: null,
    cgst: null,
    sgst: null,
    igst: null,
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

  it('a plain receipt, where no GST was added, has no tax lines and its total is what was paid', () => {
    const v = buildReceiptView(receipt())
    expect(v.detailsHeading).toBe('INVOICE DETAILS')
    expect(v.taxRows).toEqual([])
    const printed = JSON.stringify(v)
    for (const word of ['CGST', 'SGST', 'IGST', 'Taxable', 'inclusive of GST', 'Place of supply']) expect(printed).not.toContain(word)
    expect(buildReceiptView(receipt({ amount: 1180 })).total).toBe('₹1,180.00')
  })

  describe('a tax invoice, where GST was added on top of the price', () => {
    const taxed = (over: Record<string, unknown> = {}) =>
      receipt({
        number: 'FS/2026-27/0184',
        buyer: { name: 'Aman Verma', email: 'aman.verma@example.com', phone: '+91 98765 43210', stateCode: '06', stateName: 'Haryana' },
        taxableValue: 5932.2,
        gstRatePercent: 18,
        cgst: 533.9,
        sgst: 533.9,
        igst: 0,
        ...over,
      })

    it('shows the taxable value, CGST and SGST that add up to the total paid', () => {
      const v = buildReceiptView(taxed())
      expect(v.detailsHeading).toBe('TAX INVOICE')
      expect(v.taxRows).toEqual([
        ['Taxable value', '₹5,932.20'],
        ['CGST 9%', '₹533.90'],
        ['SGST 9%', '₹533.90'],
      ])
      expect(v.item.amount).toBe('₹5,932.20') // the line is the price before GST
      expect(v.total).toBe('₹7,000.00')
      expect(v.totalInWords).toBe('Rupees Seven Thousand Only · inclusive of GST')
      expect(v.amount).toBe('₹7,000.00')
      expect(v.details).toContainEqual(['Place of supply', 'Haryana (06)'])
      expect(5932.2 + 533.9 + 533.9).toBeCloseTo(7000, 2)
    })

    it('shows one IGST line for a sale made in another state', () => {
      const v = buildReceiptView(taxed({ cgst: 0, sgst: 0, igst: 1067.8, buyer: { name: 'A', email: null, phone: '1', stateCode: '27', stateName: 'Maharashtra' } }))
      expect(v.taxRows).toEqual([
        ['Taxable value', '₹5,932.20'],
        ['IGST 18%', '₹1,067.80'],
      ])
      expect(v.details).toContainEqual(['Place of supply', 'Maharashtra (27)'])
    })

    it('names a rate that does not halve evenly properly', () => {
      expect(buildReceiptView(taxed({ gstRatePercent: 5 })).taxRows.map(r => r[0])).toEqual(['Taxable value', 'CGST 2.5%', 'SGST 2.5%'])
    })

    it('draws on one page', async () => {
      const pdf = await renderReceiptPdf(taxed())
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect((pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1)
    })
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

// ─── GST on top of the plan's price ─────────────────────────────────────────

describe('GST on a plan', () => {
  const ON = { applies: true, ratePercent: 18 }

  it('adds 18% on top of the price, to the paisa: ₹5,932.20 becomes ₹7,000.00', () => {
    expect(priceWithGst(5932.2, ON)).toEqual({ gstApplies: true, ratePercent: 18, basePaise: 593220, gstPaise: 106780, totalPaise: 700000 })
    expect(priceWithGst('999', ON)).toMatchObject({ gstPaise: 17982, totalPaise: 117882 })
    expect(priceWithGst(1000, ON)).toMatchObject({ gstPaise: 18000, totalPaise: 118000 })
  })

  it('rounds the GST half-up, once', () => {
    expect(priceWithGst(100.05, ON).gstPaise).toBe(1801) // 18.009 -> 18.01
    expect(priceWithGst(0.03, ON).gstPaise).toBe(1) // 0.0054 -> 0.01
  })

  it('adds nothing when GST does not apply', () => {
    expect(priceWithGst(5932.2, { applies: false, ratePercent: 18 })).toEqual({ gstApplies: false, ratePercent: 0, basePaise: 593220, gstPaise: 0, totalPaise: 593220 })
  })

  describe('with the billing settings', () => {
    let community: { id: string }
    let member: { id: string }
    let plan: { id: string }
    const complete = { legalName: 'Finskool21', addressLine: 'C9 803, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: SELLER.gstin, sacCode: '998399', defaultGstRatePercent: 18 }

    beforeEach(async () => {
      razorpay.createOrder.mockReset()
      razorpay.createOrder.mockResolvedValue({ id: 'order_new_1' })
      Object.assign(env.razorpay, { keyId: 'rzp_test_stand_in', keySecret: 'stand_in_secret' })
      await resetDb()
      const boss = await createAdmin({ isSuperAdmin: true })
      community = await createCommunity(boss.id, { name: 'Swing Alpha' })
      member = await createMobileMember({ name: 'Aman Verma' })
      plan = await prisma.plan.create({ data: { communityId: community.id, name: 'Half-yearly', durationMonths: 6, price: 5932.2 } })
    })

    afterAll(() => {
      Object.assign(env.razorpay, { keyId: '', keySecret: '' })
    })

    const configure = (over: Record<string, unknown> = {}) =>
      prisma.billingSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...complete, ...over } as never, update: { ...complete, ...over } as never })

    it('applies once the seller details are complete and the rate is above zero, not before', async () => {
      expect(await loadGstRules(prisma)).toEqual({ applies: false, ratePercent: 18 }) // a fresh install has no GSTIN yet
      await configure()
      expect(await loadGstRules(prisma)).toEqual({ applies: true, ratePercent: 18 })
      await configure({ defaultGstRatePercent: 0 })
      expect((await loadGstRules(prisma)).applies).toBe(false)
      await configure({ defaultGstRatePercent: 18, gstin: null })
      expect((await loadGstRules(prisma)).applies).toBe(false)
    })

    it('lists each plan with the price, the GST and what the member pays', async () => {
      await configure()
      const plans = await new PaymentsService(prisma).listPlans(community.id)
      expect(plans).toEqual([{ id: plan.id, name: 'Half-yearly', durationMonths: 6, price: 5932.2, gstRatePercent: 18, gstAmount: 1067.8, totalAmount: 7000 }])
    })

    it('lists the plain price as the total while no GST is added', async () => {
      const [listed] = await new PaymentsService(prisma).listPlans(community.id)
      expect(listed).toMatchObject({ price: 5932.2, gstRatePercent: 0, gstAmount: 0, totalAmount: 5932.2 })
    })

    it('asks Razorpay for the price plus GST, and remembers the split it charged', async () => {
      await configure()
      const result = await new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)

      expect(razorpay.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 700000, currency: 'INR' }))
      expect(result).toMatchObject({ orderId: 'order_new_1', amount: 700000, baseAmount: 593220, gstAmount: 106780, gstRatePercent: 18 })
      const order = await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: 'order_new_1' } })
      expect([Number(order.amount), Number(order.baseAmount), Number(order.gstAmount), Number(order.gstRatePercent)]).toEqual([7000, 5932.2, 1067.8, 18])
    })

    it('keeps charging what the order said when the price or the rate changes before it is paid', async () => {
      await configure()
      await new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)
      await prisma.plan.update({ where: { id: plan.id }, data: { price: 9999 } })
      await configure({ defaultGstRatePercent: 5 })
      const order = await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: 'order_new_1' } })
      expect(Number(order.amount)).toBe(7000)
      expect(Number(order.gstRatePercent)).toBe(18)
    })

    it('charges the plain price, with no split, while the billing details are incomplete', async () => {
      const result = await new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)
      expect(razorpay.createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 593220 }))
      expect(result).toMatchObject({ amount: 593220, baseAmount: 593220, gstAmount: 0, gstRatePercent: 0 })
      const order = await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: 'order_new_1' } })
      expect(order.baseAmount).toBeNull()
      expect(order.gstAmount).toBeNull()
    })

    it('still refuses a plan whose total is under the ₹1 Razorpay minimum', async () => {
      await configure()
      await prisma.plan.update({ where: { id: plan.id }, data: { price: 0.5 } })
      await expect(new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)).rejects.toThrow(/minimum/)
    })

    it('issues a GST tax invoice for such an order, in the service invoices\' number series', async () => {
      await configure()
      razorpay.fetch.mockRejectedValue(new Error('no lookup'))
      // 41 service invoices have already used up this year's series.
      const fy = (await import('../../src/modules/services/services.billing.js')).financialYearOf(new Date())
      await prisma.$executeRaw`INSERT INTO invoice_counters (financial_year, last_number) VALUES (${fy}, 41)`

      await new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)
      const order = await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: 'order_new_1' } })
      await prisma.planOrder.update({ where: { id: order.id }, data: { status: 'paid', razorpayPaymentId: 'pay_gst_1' } })

      const invoice = await issuePlanReceipt(prisma, order.id, { start: new Date('2026-10-30'), end: new Date('2027-04-29') })
      expect(invoice.number).toBe(`FS/${fy}/0042`)
      expect(Number(invoice.amount)).toBe(7000)
      expect([invoice.taxableValue, invoice.cgst, invoice.sgst, invoice.igst, invoice.gstRatePercent].map(Number)).toEqual([5932.2, 533.9, 533.9, 0, 18])
      expect(invoice.buyer).toMatchObject({ stateCode: '06', stateName: 'Haryana' })

      const view = buildReceiptView(invoice)
      expect(view.detailsHeading).toBe('TAX INVOICE')
      expect(view.taxRows).toEqual([['Taxable value', '₹5,932.20'], ['CGST 9%', '₹533.90'], ['SGST 9%', '₹533.90']])
      expect(view.total).toBe('₹7,000.00')
    })

    it('gives an order with no GST a plain receipt in its own series, which never uses up an invoice number', async () => {
      razorpay.fetch.mockRejectedValue(new Error('no lookup'))
      const fy = (await import('../../src/modules/services/services.billing.js')).financialYearOf(new Date())
      await prisma.$executeRaw`INSERT INTO invoice_counters (financial_year, last_number) VALUES (${fy}, 41)`
      await new PaymentsService(prisma).createOrder(member.id, community.id, plan.id)
      const order = await prisma.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: 'order_new_1' } })
      await prisma.planOrder.update({ where: { id: order.id }, data: { status: 'paid', razorpayPaymentId: 'pay_plain_1' } })

      const receipt = await issuePlanReceipt(prisma, order.id)
      expect(receipt.number).toBe(`RCPT/${fy}/0001`)
      expect(receipt.taxableValue).toBeNull()
      expect(buildReceiptView(receipt).taxRows).toEqual([])
      const series = await prisma.$queryRaw<{ last_number: number }[]>`SELECT last_number FROM invoice_counters WHERE financial_year = ${fy}`
      expect(series[0]!.last_number).toBe(41) // untouched
    })

    it('tax invoices and plain receipts can reach the same sequence in a year', async () => {
      razorpay.fetch.mockRejectedValue(new Error('no lookup'))
      const orders = []
      for (let i = 0; i < 2; i++) {
        orders.push(await prisma.planOrder.create({ data: { userId: member.id, communityId: community.id, planId: plan.id, razorpayOrderId: `order_mix_${i}`, razorpayPaymentId: `pay_mix_${i}`, amount: 7000, status: 'paid', ...(i === 0 ? { baseAmount: 5932.2, gstAmount: 1067.8, gstRatePercent: 18 } : {}) } as never }))
      }
      await configure()
      const [invoice, receipt] = [await issuePlanReceipt(prisma, orders[0]!.id), await issuePlanReceipt(prisma, orders[1]!.id)]
      expect(invoice.sequence).toBe(1)
      expect(receipt.sequence).toBe(1)
      expect(invoice.number).not.toBe(receipt.number)
    })
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

// ─── The communities a member has bought, each with its invoice ─────────────

describe('GET /auth/mobile/me: the invoice of each community bought', () => {
  let boss: TestAdmin
  let swing: { id: string }
  let options: { id: string }
  let swingPlan: { id: string }
  let n = 0

  const me = (m: Parameters<typeof mobileCookie>[0]) => request(app).get('/api/v1/auth/mobile/me').set('Cookie', mobileCookie(m))
  const community = (res: request.Response, id: string) => res.body.data.communities.find((c: { id: string }) => c.id === id)

  /** A paid order for a community and its invoice, `daysAgo` days old. Its PDF counts as stored unless `stored` is false. */
  async function bought(memberId: string, communityId: string, planId: string, daysAgo: number, stored = true) {
    n += 1
    const order = await prisma.planOrder.create({
      data: { userId: memberId, communityId, planId, razorpayOrderId: `order_me_${n}`, razorpayPaymentId: `pay_me_${n}`, amount: 1178.82, baseAmount: 999, gstAmount: 179.82, gstRatePercent: 18, status: 'paid' } as never,
    })
    const receipt = await issuePlanReceipt(prisma, order.id, { start: new Date('2026-10-30'), end: new Date('2027-01-30') })
    return prisma.planReceipt.update({
      where: { id: receipt.id },
      data: { issuedAt: new Date(Date.now() - daysAgo * 86_400_000), ...(stored ? { pdfObjectKey: `receipts/${receipt.financialYear}/${receipt.number.replace(/\//g, '-')}.pdf` } : {}) },
    })
  }

  beforeEach(async () => {
    razorpay.fetch.mockReset()
    razorpay.fetch.mockRejectedValue(new Error('no lookup'))
    storage.sign.mockReset()
    storage.sign.mockImplementation(async (key: string, fileName: string) => `https://files.test/${key}?file=${fileName}&X-Amz-Expires=300`)
    storage.upload.mockReset()
    storage.upload.mockResolvedValue(undefined)
    await resetDb()
    boss = await createAdmin({ isSuperAdmin: true })
    swing = await createCommunity(boss.id, { name: 'Swing Alpha' })
    options = await createCommunity(boss.id, { name: 'Options Lab' })
    swingPlan = await prisma.plan.create({ data: { communityId: swing.id, name: '3 Month', durationMonths: 3, price: 999 } })
    await prisma.billingSettings.create({
      data: { id: 'default', legalName: 'Finskool21', addressLine: 'C9 803, Sector 88', city: 'Faridabad', pincode: '121002', stateCode: '06', gstin: SELLER.gstin, sacCode: '998399', defaultGstRatePercent: 18 },
    })
  })

  it('gives each community the invoice of its latest purchase, with a link that opens the PDF', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    const invoice = await bought(member.id, swing.id, swingPlan.id, 2)

    const res = await me(member)
    expect(res.status).toBe(200)
    const row = community(res, swing.id)
    expect(row.invoice).toMatchObject({
      id: invoice.id,
      number: invoice.number,
      amount: 1178.82,
      currency: 'INR',
      issuedAt: invoice.issuedAt.toISOString(),
      fileName: `${invoice.number.replace(/\//g, '-')}.pdf`,
    })
    // A signed link to the stored PDF, under the name it should be saved as.
    expect(storage.sign).toHaveBeenCalledWith(invoice.pdfObjectKey, row.invoice.fileName)
    expect(row.invoice.downloadUrl).toBe(`https://files.test/${invoice.pdfObjectKey}?file=${row.invoice.fileName}&X-Amz-Expires=300`)
    expect(storage.upload).not.toHaveBeenCalled() // it was stored already, so nothing is drawn again
    expect(row.expiresAt).toBe(daysFromNow(60))
  })

  it('shows the latest purchase\'s invoice when the member renewed', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    await bought(member.id, swing.id, swingPlan.id, 90)
    const renewal = await bought(member.id, swing.id, swingPlan.id, 3)
    await bought(member.id, swing.id, swingPlan.id, 40)

    expect(community(await me(member), swing.id).invoice.id).toBe(renewal.id)
  })

  it('has no invoice for a community the member was added to by an admin', async () => {
    const member = await createMobileMember({
      subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }, { communityId: options.id, validUntil: daysFromNow(30) }],
    })
    const invoice = await bought(member.id, swing.id, swingPlan.id, 2)

    const res = await me(member)
    expect(community(res, swing.id).invoice.id).toBe(invoice.id)
    expect(community(res, options.id).invoice).toBeNull()
  })

  it('keeps a lapsed community, and its invoice, in the list', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(-20), isActive: false }] })
    await bought(member.id, swing.id, swingPlan.id, 100)
    const row = community(await me(member), swing.id)
    expect(row.expiresAt < daysFromNow(0)).toBe(true)
    expect(row.invoice).not.toBeNull()
  })

  it('never shows another member\'s invoice', async () => {
    const mine = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    const theirs = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    await bought(theirs.id, swing.id, swingPlan.id, 1)

    expect(community(await me(mine), swing.id).invoice).toBeNull()
  })

  it('draws and stores the PDF first when that has not happened yet', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    const invoice = await bought(member.id, swing.id, swingPlan.id, 2, false)

    const row = community(await me(member), swing.id)
    expect(row.invoice.downloadUrl).toMatch(/^https:\/\/files\.test\/receipts\/.+\.pdf\?file=.+\.pdf/)
    expect(storage.upload).toHaveBeenCalledTimes(1)
    const [key, pdf] = storage.upload.mock.calls[0] as [string, Buffer]
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await prisma.planReceipt.findUniqueOrThrow({ where: { id: invoice.id } })).pdfObjectKey).toBe(key)
  })

  it('still answers, with no link, when the PDF is not stored and storage cannot be reached', async () => {
    storage.upload.mockRejectedValue(new Error('storage is down'))
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    const invoice = await bought(member.id, swing.id, swingPlan.id, 2, false)

    const res = await me(member)
    expect(res.status).toBe(200)
    const row = community(res, swing.id)
    expect(row.invoice).toMatchObject({ id: invoice.id, number: invoice.number, downloadUrl: null })
  })

  it('the receipts list says which community each invoice is for', async () => {
    const member = await createMobileMember({ subscriptions: [{ communityId: swing.id, validUntil: daysFromNow(60) }] })
    const invoice = await bought(member.id, swing.id, swingPlan.id, 2)
    const res = await request(app).get('/api/v1/payments/receipts').set('Cookie', mobileCookie(member))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([expect.objectContaining({ id: invoice.id, communityId: swing.id, amount: 1178.82 })])
  })
})
