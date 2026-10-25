import PDFDocument from 'pdfkit'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { generateInvoiceDownloadUrl, uploadInvoicePdf } from '../../lib/minio.js'
import { logger } from '../../shared/logger.js'
import type { ConfiguredBillingSettings } from './billing-settings.js'
import {
  amountInWords,
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

// Standard PDF fonts have no rupee sign, so amounts are written as "INR 1,180.00".
const inr = (value: Prisma.Decimal | number | string): string =>
  `INR ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const istDate = (d: Date): string => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })

const INK = '#1a1a1a'
const MUTED = '#666666'
const LINE = '#cfcfcf'

export function renderInvoicePdf(invoice: ServiceInvoiceRow): Promise<Buffer> {
  const seller = invoice.seller as unknown as InvoiceSeller
  const buyer = invoice.buyer as unknown as InvoiceBuyer

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Tax Invoice ${invoice.number}`, Author: seller.legalName } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = 40
    const right = 555
    const width = right - left

    // Header: seller on the left, title and invoice details on the right.
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(seller.legalName, left, 40, { width: 300 })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    doc.text(seller.addressLine, left, doc.y + 2, { width: 300 })
    doc.text(`${seller.city} ${seller.pincode}, ${seller.stateName} (${seller.stateCode})`, { width: 300 })
    doc.text(`GSTIN: ${seller.gstin}`, { width: 300 })
    const contact = [seller.contactEmail, seller.contactPhone].filter(Boolean).join('  |  ')
    if (contact) doc.text(contact, { width: 300 })

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('TAX INVOICE', 340, 40, { width: right - 340, align: 'right' })
    doc.font('Helvetica').fontSize(10).fillColor(INK)
    doc.text(`Invoice No: ${invoice.number}`, 340, 70, { width: right - 340, align: 'right' })
    doc.text(`Date: ${istDate(invoice.issuedAt)}`, 340, doc.y + 2, { width: right - 340, align: 'right' })
    doc.text(`Place of supply: ${buyer.stateName} (${buyer.stateCode})`, 340, doc.y + 2, { width: right - 340, align: 'right' })

    let y = Math.max(doc.y, 130) + 16
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke()

    // Bill to
    y += 12
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('BILL TO', left, y)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(buyer.name, left, doc.y + 2, { width: 320 })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    if (buyer.address) doc.text(buyer.address, { width: 320 })
    doc.text(`${buyer.stateName} (${buyer.stateCode})`, { width: 320 })
    if (buyer.gstin) doc.text(`GSTIN: ${buyer.gstin}`, { width: 320 })

    // Line item. Money cells carry no "INR" (the headers say it), so large amounts still fit their column.
    y = doc.y + 18
    const col = {
      desc: { x: left + 6, w: 180 },
      sac: { x: 232, w: 40 },
      taxable: { x: 278, w: 88 },
      rate: { x: 372, w: 34 },
      gst: { x: 410, w: 66 },
      total: { x: 480, w: right - 480 - 4 },
    }
    const num = (v: Prisma.Decimal | number | string) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    doc.rect(left, y, width, 20).fill('#f1f1f1')
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5)
    doc.text('Description', col.desc.x, y + 6, { width: col.desc.w })
    doc.text('SAC', col.sac.x, y + 6, { width: col.sac.w })
    doc.text('Taxable (INR)', col.taxable.x, y + 6, { width: col.taxable.w, align: 'right' })
    doc.text('GST %', col.rate.x, y + 6, { width: col.rate.w, align: 'right' })
    doc.text('GST (INR)', col.gst.x, y + 6, { width: col.gst.w, align: 'right' })
    doc.text('Total (INR)', col.total.x, y + 6, { width: col.total.w, align: 'right' })

    y += 28
    const gstTotal = Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst)
    doc.font('Helvetica').fontSize(9)
    const descHeight = doc.heightOfString(invoice.description, { width: col.desc.w })
    doc.text(invoice.description, col.desc.x, y, { width: col.desc.w })
    doc.text(invoice.sacCode, col.sac.x, y, { width: col.sac.w })
    doc.text(num(invoice.taxableValue), col.taxable.x, y, { width: col.taxable.w, align: 'right' })
    doc.text(`${Number(invoice.gstRatePercent)}%`, col.rate.x, y, { width: col.rate.w, align: 'right' })
    doc.text(num(gstTotal), col.gst.x, y, { width: col.gst.w, align: 'right' })
    doc.text(num(invoice.total), col.total.x, y, { width: col.total.w, align: 'right' })

    y += Math.max(descHeight, 14) + 10
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke()

    // Totals
    y += 12
    const label = 340
    const value = 440
    const row = (name: string, amount: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(INK)
      doc.text(name, label, y, { width: 100 })
      doc.text(amount, value, y, { width: right - value, align: 'right' })
      y += bold ? 20 : 16
    }
    row('Taxable value', inr(invoice.taxableValue))
    const rate = Number(invoice.gstRatePercent)
    if (Number(invoice.igst) > 0) {
      row(`IGST @ ${rate}%`, inr(invoice.igst))
    } else {
      row(`CGST @ ${rate / 2}%`, inr(invoice.cgst))
      row(`SGST @ ${rate / 2}%`, inr(invoice.sgst))
    }
    doc.moveTo(label, y - 2).lineTo(right, y - 2).strokeColor(LINE).stroke()
    y += 4
    row('Total', inr(invoice.total), true)

    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Amount in words', left, y + 6)
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(amountInWords(rupeesToPaise(invoice.total.toString())), left, doc.y + 2, { width })

    // Footer
    const footerY = Math.max(doc.y + 40, 700)
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    if (seller.footerNote) doc.text(seller.footerNote, left, footerY, { width })
    doc.text('This is a computer-generated invoice and does not require a signature.', left, doc.y + 6, { width })

    doc.end()
  })
}

// ─── Storage ────────────────────────────────────────────────────────────────

const pdfFileName = (invoice: Pick<ServiceInvoiceRow, 'number'>): string => `${invoice.number.replace(/\//g, '-')}.pdf`

/**
 * Renders the invoice PDF and stores it, once. Called right after payment (in the background) and
 * again on demand when a member or admin asks for the file, so a crash between the two never
 * leaves an invoice without a PDF.
 */
export async function ensureInvoicePdf(db: PrismaClient, invoiceId: string): Promise<string> {
  const invoice = await db.serviceInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
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
