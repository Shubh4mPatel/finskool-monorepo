import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// The file store and Razorpay are not reachable from the tests.
const storage = vi.hoisted(() => ({ sign: vi.fn(), upload: vi.fn() }))
vi.mock('../../src/lib/minio.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/minio.js')>()),
  generateInvoiceDownloadUrl: storage.sign,
  uploadInvoicePdf: storage.upload,
}))

import { buildReceiptView } from '../../src/lib/receipt-pdf.js'
import { ensureInvoicePdf, invoicePdfInclude, renderInvoicePdf, toReceiptInput } from '../../src/modules/services/services.invoice.js'
import { prisma, resetDb, createAdmin, createMobileMember, createServiceInvoice, createServiceRequest } from '../helpers/fixtures.js'

// A service invoice is drawn with the same layout as a community plan's invoice (lib/receipt-pdf.ts): the invoice is
// mapped onto it, so the two read alike, and what is only true of a service (no access period) is left out.

const SELLER = {
  legalName: 'Finskool21', addressLine: '12 MG Road', city: 'Pune', pincode: '411001', stateCode: '27', stateName: 'Maharashtra',
  gstin: '27ABCDE1234F1Z5', contactEmail: 'billing@finskool21.in', contactPhone: '+91 20 5555 0100', footerNote: 'Thank you.',
  sebiRegistrationNo: 'INH000022987', proprietorName: 'A. Founder', pan: 'ABCDE1234F', website: 'finskool21.in',
}
const BUYER = { name: 'Priya Shah', stateCode: '27', stateName: 'Maharashtra', gstin: '27AAAAA0000A1Z5', address: '4 Park Street, Mumbai' }

let invoiceId: string

beforeEach(async () => {
  await resetDb()
  storage.upload.mockReset()
  const admin = await createAdmin({ isSuperAdmin: true })
  const member = await createMobileMember({ name: 'Priya Shah', email: 'priya@example.com' })
  const request = await createServiceRequest({ userId: member.id, status: 'paid', title: 'Portfolio review' })
  const invoice = await createServiceInvoice({ requestId: request.id, userId: member.id, adminId: admin.id, total: 1180, issuedAt: new Date('2026-10-30T05:12:00Z') })
  await prisma.serviceInvoice.update({
    where: { id: invoice.id },
    data: { seller: SELLER, buyer: BUYER, description: 'Portfolio review - Service request SR-7', taxableValue: 1000, gstRatePercent: 18, cgst: 90, sgst: 90, igst: 0 },
  })
  await prisma.razorpayPayment.update({
    where: { id: invoice.paymentId },
    data: { method: 'upi', raw: { method: 'upi', vpa: 'priya.shah@okhdfcbank', created_at: 1_793_000_000 } },
  })
  invoiceId = invoice.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

const load = () => prisma.serviceInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoicePdfInclude })

describe('a service invoice', () => {
  it('says what a community invoice says: the same sections, from the service invoice\'s own details', async () => {
    const v = buildReceiptView(toReceiptInput(await load()), { subtitle: 'Service availed through the Finskool21 app' })

    expect(v.brand).toBe('Finskool21')
    expect(v.tagline).toBe('SEBI Registered Research Analyst · INH000022987')
    expect(v.amount).toBe('₹1,180.00')
    expect(v.detailsHeading).toBe('TAX INVOICE')
    expect(v.details[0]![0]).toBe('Invoice no.')
    expect(v.details).toContainEqual(['Place of supply', 'Maharashtra (27)'])
    expect(v.billedTo).toEqual({ name: 'Priya Shah', lines: ['priya@example.com', expect.any(String), '4 Park Street, Mumbai', 'GSTIN 27AAAAA0000A1Z5'] })
    expect(v.item).toMatchObject({ title: 'Portfolio review - Service request SR-7', sac: '998313', period: null, amount: '₹1,000.00' })
    expect(v.taxRows).toEqual([['Taxable value', '₹1,000.00'], ['CGST 9%', '₹90.00'], ['SGST 9%', '₹90.00']])
    expect(v.total).toBe('₹1,180.00')
    // How it was paid, from Razorpay's record of the payment, with the UPI id hidden.
    expect(v.payment.find(c => c.label === 'Payment method')).toMatchObject({ value: 'UPI', detail: 'priya.•••@okhdfcbank' })
    expect(v.payment.find(c => c.label === 'Payment ID')!.value).toMatch(/^pay_/)
    // A service has no period of access to describe.
    expect(v.accessNote).toBe('For billing questions, write to billing@finskool21.in with your invoice number.')
  })

  it('uses IGST when the sale is to another state', async () => {
    await prisma.serviceInvoice.update({ where: { id: invoiceId }, data: { cgst: 0, sgst: 0, igst: 180, buyer: { ...BUYER, stateCode: '29', stateName: 'Karnataka' } } })
    const v = buildReceiptView(toReceiptInput(await load()))
    expect(v.taxRows).toEqual([['Taxable value', '₹1,000.00'], ['IGST 18%', '₹180.00']])
    expect(v.details).toContainEqual(['Place of supply', 'Karnataka (29)'])
  })

  it('still draws when the invoice was issued before the seller\'s registration details were kept', async () => {
    const { sebiRegistrationNo, proprietorName, pan, website, ...old } = SELLER
    void sebiRegistrationNo, proprietorName, pan, website
    await prisma.serviceInvoice.update({ where: { id: invoiceId }, data: { seller: old } })
    const pdf = await renderInvoicePdf(await load())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buildReceiptView(toReceiptInput(await load())).tagline).toBeNull()
  })

  it('is drawn on one page by the community invoice\'s renderer, and stored once', async () => {
    const pdf = await renderInvoicePdf(await load())
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1)
    // The same fonts as the plan invoice, not the plain built-in ones the old layout used.
    expect(pdf.toString('latin1')).toContain('Inter')

    const key = await ensureInvoicePdf(prisma as never, invoiceId)
    expect(storage.upload).toHaveBeenCalledTimes(1)
    expect(key).toContain('.pdf')
    await ensureInvoicePdf(prisma as never, invoiceId)
    expect(storage.upload).toHaveBeenCalledTimes(1)
  })
})
