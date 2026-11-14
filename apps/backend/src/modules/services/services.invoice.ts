import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { generateInvoiceDownloadUrl, uploadInvoicePdf } from '../../lib/minio.js'
import { describePayment, type PaymentSnapshot, type RazorpayPaymentRecord } from '../../lib/payment-details.js'
import { renderReceiptPdf, type ReceiptBuyer, type ReceiptInput, type ReceiptSeller } from '../../lib/receipt-pdf.js'
import { logger } from '../../shared/logger.js'
import type { ConfiguredBillingSettings } from './billing-settings.js'
import {
  formatInvoiceNumber,
  gstStateName,
  paiseToDecimal,
  rupeesToPaise,
  splitGst,
} from './services.billing.js'

export type ServiceInvoiceRow = Prisma.ServiceInvoiceGetPayload<object>

/** Seller as it was when the invoice was issued. */
export interface InvoiceSeller {
  legalName: string
  addressLine: string
  city: string
  pincode: string
  stateCode: string
  stateName: string
  gstin: string
  contactEmail: string | null
  contactPhone: string | null
  footerNote: string | null
  // Printed in the invoice's footer. Absent on invoices issued before these were kept.
  proprietorName?: string | null
  pan?: string | null
  sebiRegistrationNo?: string | null
  website?: string | null
}

/** Buyer as the member entered it when they paid. */
export interface InvoiceBuyer {
  name: string
  stateCode: string
  stateName: string
  gstin: string | null
  address: string | null
}

export interface MemberBilling {
  name: string
  stateCode: string
  gstin?: string | null
  address?: string | null
}

export function toInvoiceBuyer(billing: MemberBilling): InvoiceBuyer {
  return {
    name: billing.name,
    stateCode: billing.stateCode,
    stateName: gstStateName(billing.stateCode),
    gstin: billing.gstin ?? null,
    address: billing.address ?? null,
  }
}

function toInvoiceSeller(s: ConfiguredBillingSettings): InvoiceSeller {
  return {
    legalName: s.legalName,
    addressLine: s.addressLine,
    city: s.city,
    pincode: s.pincode,
    stateCode: s.stateCode,
    stateName: gstStateName(s.stateCode),
    gstin: s.gstin,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    footerNote: s.footerNote,
    proprietorName: s.proprietorName,
    pan: s.pan,
    sebiRegistrationNo: s.sebiRegistrationNo,
    website: s.website,
  }
}

interface InvoiceInput {
  requestId: string
  quoteId: string
  paymentId: string
  settings: ConfiguredBillingSettings
  buyer: InvoiceBuyer
  description: string
  baseAmount: Prisma.Decimal | number | string
  gstAmount: Prisma.Decimal | number | string
  gstRatePercent: Prisma.Decimal | number | string
  totalAmount: Prisma.Decimal | number | string
  financialYear: string
  sequence: number
  issuedAt: Date
}

/** The row to insert for a paid quote. Tax is split from the quote's own GST amount, so the total is never recomputed. */
export function buildInvoiceData(input: InvoiceInput): Prisma.ServiceInvoiceUncheckedCreateInput {
  const gstPaise = rupeesToPaise(input.gstAmount.toString())
  const split = splitGst(gstPaise, input.settings.stateCode, input.buyer.stateCode)
  return {
    requestId: input.requestId,
    quoteId: input.quoteId,
    paymentId: input.paymentId,
    number: formatInvoiceNumber(input.settings.invoicePrefix, input.financialYear, input.sequence),
    financialYear: input.financialYear,
    sequence: input.sequence,
    issuedAt: input.issuedAt,
    seller: toInvoiceSeller(input.settings) as unknown as Prisma.InputJsonValue,
    buyer: input.buyer as unknown as Prisma.InputJsonValue,
    description: input.description.slice(0, 500),
    sacCode: input.settings.sacCode,
    taxableValue: paiseToDecimal(rupeesToPaise(input.baseAmount.toString())),
    gstRatePercent: input.gstRatePercent.toString(),
    cgst: paiseToDecimal(split.cgstPaise),
    sgst: paiseToDecimal(split.sgstPaise),
    igst: paiseToDecimal(split.igstPaise),
    total: paiseToDecimal(rupeesToPaise(input.totalAmount.toString())),
  }
}

// ─── PDF ────────────────────────────────────────────────────────────────────

// A service invoice is drawn by the same renderer as a community plan's invoice (lib/receipt-pdf.ts), so both look the
// same: the invoice is mapped onto the fields that renderer prints.

/** What the PDF needs besides the invoice row itself: how it was paid, and the member's contact details. */
export const invoicePdfInclude = {
  payment: { select: { razorpayPaymentId: true, method: true, raw: true, createdAt: true, order: { select: { razorpayOrderId: true } } } },
  request: { select: { user: { select: { email: true, phone: true } } } },
} satisfies Prisma.ServiceInvoiceInclude

export type ServiceInvoiceForPdf = Prisma.ServiceInvoiceGetPayload<{ include: typeof invoicePdfInclude }>

/** How the invoice was paid. Razorpay's own record of the payment (kept when it was settled) says it best. */
function paymentSnapshot(p: ServiceInvoiceForPdf['payment']): PaymentSnapshot {
  const raw = p.raw && typeof p.raw === 'object' && !Array.isArray(p.raw) ? (p.raw as RazorpayPaymentRecord) : {}
  return describePayment({
    ...raw,
    method: raw.method ?? p.method,
    order_id: raw.order_id ?? p.order.razorpayOrderId,
    created_at: raw.created_at ?? Math.floor(p.createdAt.getTime() / 1000),
  })
}

export function toReceiptInput(invoice: ServiceInvoiceForPdf): ReceiptInput {
  const seller = invoice.seller as unknown as InvoiceSeller
  const buyer = invoice.buyer as unknown as InvoiceBuyer
  const receiptSeller: ReceiptSeller = {
    legalName: seller.legalName,
    address: `${seller.addressLine}, ${seller.city} ${seller.pincode}, ${seller.stateName}`,
    gstin: seller.gstin,
    contactEmail: seller.contactEmail,
    contactPhone: seller.contactPhone,
    footerNote: seller.footerNote,
    proprietorName: seller.proprietorName ?? null,
    pan: seller.pan ?? null,
    sebiRegistrationNo: seller.sebiRegistrationNo ?? null,
    website: seller.website ?? null,
    sacCode: invoice.sacCode,
  }
  const receiptBuyer: ReceiptBuyer = {
    name: buyer.name,
    email: invoice.request.user.email,
    phone: invoice.request.user.phone,
    stateCode: buyer.stateCode,
    stateName: buyer.stateName,
    address: buyer.address,
    gstin: buyer.gstin,
  }
  return {
    number: invoice.number,
    issuedAt: invoice.issuedAt,
    seller: receiptSeller as unknown as Prisma.JsonValue,
    buyer: receiptBuyer as unknown as Prisma.JsonValue,
    description: invoice.description,
    amount: invoice.total,
    razorpayPaymentId: invoice.payment.razorpayPaymentId,
    payment: paymentSnapshot(invoice.payment) as unknown as Prisma.JsonValue,
    taxableValue: invoice.taxableValue,
    gstRatePercent: invoice.gstRatePercent,
    cgst: invoice.cgst,
    sgst: invoice.sgst,
    igst: invoice.igst,
    periodStart: null,
    periodEnd: null,
  }
}

export function renderInvoicePdf(invoice: ServiceInvoiceForPdf): Promise<Buffer> {
  const seller = invoice.seller as unknown as InvoiceSeller
  return renderReceiptPdf(toReceiptInput(invoice), { subtitle: `Service availed through the ${seller.legalName} app` })
}

// ─── Storage ────────────────────────────────────────────────────────────────

const pdfFileName = (invoice: Pick<ServiceInvoiceRow, 'number'>): string => `${invoice.number.replace(/\//g, '-')}.pdf`

/**
 * Renders the invoice PDF and stores it, once. Called right after payment (in the background) and
 * again on demand when a member or admin asks for the file, so a crash between the two never
 * leaves an invoice without a PDF.
 */
export async function ensureInvoicePdf(db: PrismaClient, invoiceId: string): Promise<string> {
  const invoice = await db.serviceInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoicePdfInclude })
  if (invoice.pdfObjectKey) return invoice.pdfObjectKey
  const pdf = await renderInvoicePdf(invoice)
  const objectKey = `${invoice.financialYear}/${pdfFileName(invoice)}`
  await uploadInvoicePdf(objectKey, pdf)
  await db.serviceInvoice.update({ where: { id: invoiceId }, data: { pdfObjectKey: objectKey } })
  return objectKey
}

/** Fire-and-forget after the payment commits: a failure is logged and retried by the on-demand path. */
export function renderInvoiceInBackground(db: PrismaClient, invoiceId: string): void {
  ensureInvoicePdf(db, invoiceId).catch(err => logger.error({ err, invoiceId }, 'invoice: background PDF render failed'))
}

export async function getInvoiceDownloadUrl(db: PrismaClient, invoiceId: string): Promise<{ url: string; fileName: string }> {
  const objectKey = await ensureInvoicePdf(db, invoiceId)
  const invoice = await db.serviceInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { number: true } })
  const fileName = pdfFileName(invoice)
  return { url: await generateInvoiceDownloadUrl(objectKey, fileName), fileName }
}
