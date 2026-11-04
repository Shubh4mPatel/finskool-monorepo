import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Prisma } from '../generated/prisma/client.js'
import { amountInWords, rupeesToPaise } from '../modules/services/services.billing.js'
import type { PaymentSnapshot } from './payment-details.js'

// The invoice a member gets for a plan. `buildReceiptView` decides what is printed (and leaves out whatever is not
// known), `renderReceiptPdf` draws it. Plan prices carry no GST, so there is no tax split: the total is what was paid.

/** The seller as they were when the receipt was issued (a snapshot, so later edits to the settings change nothing here). */
export interface ReceiptSeller {
  legalName: string
  address: string | null
  gstin: string | null
  contactEmail: string | null
  contactPhone: string | null
  footerNote: string | null
  proprietorName?: string | null
  pan?: string | null
  sebiRegistrationNo?: string | null
  website?: string | null
  sacCode?: string | null
}

export interface ReceiptBuyer {
  name: string
  email: string | null
  phone: string
  /** Where the sale is taken to be made, on a tax invoice: GST state code and name. */
  stateCode?: string
  stateName?: string
}

export type ReceiptData = Prisma.PlanReceiptGetPayload<object>

/** One labelled cell of the payment box. */
export interface PaymentCell {
  label: string
  value: string
  /** Muted text after the value: the masked UPI id, the card, the bank. */
  detail?: string
  /** Drawn green: the payment went through. */
  ok?: boolean
}

export interface ReceiptView {
  brand: string
  /** "SEBI Registered Research Analyst · INH000022987", or null when the seller has no registration number set. */
  tagline: string | null
  amount: string
  paidOn: string
  billedTo: { name: string; lines: string[] }
  /** "TAX INVOICE" when GST was charged on top of the price, "INVOICE DETAILS" for a plain receipt. */
  detailsHeading: string
  details: [label: string, value: string][]
  item: { title: string; subtitle: string; sac: string | null; period: string[] | null; amount: string }
  /** Taxable value, then CGST + SGST (or IGST): the lines above the total on a tax invoice. Empty on a plain receipt. */
  taxRows: [label: string, amount: string][]
  total: string
  totalInWords: string
  payment: PaymentCell[]
  accessNote: string | null
  footer: { left: { name: string; rest: string | null; lines: string[] }; right: string[]; fineprint: string[] }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** "30 Oct 2026", on the Indian calendar. */
export function formatDay(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  return `${ist.getUTCDate()} ${MONTHS[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`
}

/** "30 Oct 2026, 10:42 am", Indian time. */
export function formatDayAndTime(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const hours = ist.getUTCHours()
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${formatDay(d)}, ${hour12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${hours < 12 ? 'am' : 'pm'}`
}

export const formatRupees = (v: Prisma.Decimal | number | string): string =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SEBI_DISCLAIMER =
  'Investment in securities market are subject to market risks. Read all the related documents carefully before investing. ' +
  'Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.'

// ─── What is printed ────────────────────────────────────────────────────────

export function buildReceiptView(receipt: ReceiptData): ReceiptView {
  const seller = receipt.seller as unknown as ReceiptSeller
  const buyer = receipt.buyer as unknown as ReceiptBuyer
  const payment = (receipt.payment ?? null) as unknown as Partial<PaymentSnapshot> | null
  const paidAt = payment?.paidAt ? new Date(payment.paidAt) : receipt.issuedAt
  const amount = formatRupees(receipt.amount)
  const registered = Boolean(seller.sebiRegistrationNo)

  // A tax invoice: the plan's price (taxable value) and the GST on top of it add up to the total paid.
  const taxed = receipt.taxableValue !== null
  const percent = (n: number) => String(Number(n.toFixed(2)))
  const rate = Number(receipt.gstRatePercent ?? 0)
  const taxRows: [string, string][] = []
  if (taxed) {
    taxRows.push(['Taxable value', formatRupees(receipt.taxableValue!)])
    if (Number(receipt.cgst ?? 0) > 0 || Number(receipt.sgst ?? 0) > 0) {
      taxRows.push([`CGST ${percent(rate / 2)}%`, formatRupees(receipt.cgst ?? 0)], [`SGST ${percent(rate / 2)}%`, formatRupees(receipt.sgst ?? 0)])
    }
    if (Number(receipt.igst ?? 0) > 0) taxRows.push([`IGST ${percent(rate)}%`, formatRupees(receipt.igst!)])
  }
  const supplyState = buyer.stateName && buyer.stateCode ? `${buyer.stateName} (${buyer.stateCode})` : null
  const period =
    receipt.periodStart && receipt.periodEnd ? [`${formatDay(receipt.periodStart)} –`, formatDay(receipt.periodEnd)] : null

  const paymentCells: PaymentCell[] = []
  if (payment?.method) paymentCells.push({ label: 'Payment method', value: payment.method, ...(payment.detail ? { detail: payment.detail } : {}) })
  paymentCells.push({ label: 'Paid through', value: 'Razorpay' })
  paymentCells.push({ label: 'Paid on', value: formatDayAndTime(paidAt) })
  if (receipt.razorpayPaymentId) paymentCells.push({ label: 'Payment ID', value: receipt.razorpayPaymentId })
  if (payment?.orderId) paymentCells.push({ label: 'Order ID', value: payment.orderId })
  paymentCells.push({ label: 'Status', value: 'Successful', ok: true })

  const accessNote =
    [
      period ? `Access is active from ${formatDay(receipt.periodStart!)} to ${formatDay(receipt.periodEnd!)} and does not renew automatically.` : null,
      seller.contactEmail ? `For billing questions, write to ${seller.contactEmail} with your invoice number.` : null,
    ]
      .filter(Boolean)
      .join(' ') || null

  const registrationLine = [seller.gstin ? `GSTIN ${seller.gstin}` : null, seller.pan ? `PAN ${seller.pan}` : null].filter(Boolean).join(' · ')
  const fineprint = [
    registered ? SEBI_DISCLAIMER : null,
    seller.footerNote || null,
    [
      'This is a computer-generated invoice and does not require a signature.',
      registered && seller.contactEmail ? `Grievances: ${seller.contactEmail} · scores.sebi.gov.in` : null,
    ]
      .filter(Boolean)
      .join(' '),
  ].filter((line): line is string => Boolean(line))

  return {
    brand: seller.legalName,
    tagline: registered ? `SEBI Registered Research Analyst · ${seller.sebiRegistrationNo}` : null,
    amount,
    paidOn: formatDay(paidAt),
    billedTo: { name: buyer.name, lines: [buyer.email, buyer.phone].filter((l): l is string => Boolean(l)) },
    detailsHeading: taxed ? 'TAX INVOICE' : 'INVOICE DETAILS',
    details: [
      ['Invoice no.', receipt.number],
      ['Invoice date', formatDay(receipt.issuedAt)],
      ...(taxed && supplyState ? [['Place of supply', supplyState] as [string, string]] : []),
    ],
    item: {
      title: receipt.description,
      subtitle: `Research subscription with community access in the ${seller.legalName} app`,
      sac: seller.sacCode || null,
      period,
      // On a tax invoice the line is the price before GST; the GST is added below it.
      amount: taxed ? formatRupees(receipt.taxableValue!) : amount,
    },
    taxRows,
    total: amount,
    totalInWords: `${amountInWords(rupeesToPaise(receipt.amount.toString()))}${taxed ? ' · inclusive of GST' : ''}`,
    payment: paymentCells,
    accessNote,
    footer: {
      left: {
        name: seller.legalName,
        rest: seller.proprietorName ? ` · Proprietor: ${seller.proprietorName}` : null,
        lines: [seller.address, registrationLine || null].filter((l): l is string => Boolean(l)),
      },
      right: [seller.contactEmail, seller.contactPhone, seller.website].filter((l): l is string => Boolean(l)),
      fineprint,
    },
  }
}

// ─── Drawing ────────────────────────────────────────────────────────────────

const ASSETS = path.join(process.cwd(), 'assets', 'invoice')
const FONT = { regular: path.join(ASSETS, 'Inter-Regular.ttf'), medium: path.join(ASSETS, 'Inter-Medium.ttf'), semibold: path.join(ASSETS, 'Inter-SemiBold.ttf') }
const LOGO = path.join(process.cwd(), 'email-template', 'logo.png')

const PRIMARY = '#153d3a'
const INK = '#1c1f1e'
const BODY = '#585f5c'
const MUTED = '#8b918e'
const GREEN = '#2f7d3b'
const HAIRLINE = '#e3e6e4'
const BOX = '#dde1de'

const LEFT = 57
const RIGHT = 538.28
const WIDTH = RIGHT - LEFT

export function renderReceiptPdf(receipt: ReceiptData): Promise<Buffer> {
  const v = buildReceiptView(receipt)
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Invoice ${receipt.number}`, Author: v.brand } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const text = (s: string, x: number, y: number, opts: { font?: keyof typeof FONT; size?: number; color?: string; width?: number; align?: 'left' | 'right'; spacing?: number; lineGap?: number } = {}) => {
      doc.font(FONT[opts.font ?? 'regular']).fontSize(opts.size ?? 9).fillColor(opts.color ?? BODY)
      doc.text(s, x, y, { width: opts.width ?? WIDTH, align: opts.align ?? 'left', characterSpacing: opts.spacing ?? 0, lineGap: opts.lineGap ?? 0 })
    }
    const heightOf = (s: string, width: number, font: keyof typeof FONT, size: number, lineGap = 0) => {
      doc.font(FONT[font]).fontSize(size)
      return doc.heightOfString(s, { width, lineGap })
    }
    const rule = (y: number, x1: number, x2: number, color: string, weight: number) => {
      doc.moveTo(x1, y).lineTo(x2, y).lineWidth(weight).strokeColor(color).stroke()
    }

    // ── Header: logo and name on the left, the amount on the right
    const logo = 41
    doc.save().circle(LEFT + logo / 2, 58 + logo / 2, logo / 2).clip()
    doc.image(LOGO, LEFT, 58, { width: logo, height: logo })
    doc.restore()
    doc.circle(LEFT + logo / 2, 58 + logo / 2, logo / 2).lineWidth(0.75).strokeColor(BOX).stroke()
    const nameX = LEFT + logo + 11
    text(v.brand, nameX, v.tagline ? 66 : 70, { font: 'semibold', size: 14.5, color: PRIMARY, width: 260 })
    if (v.tagline) text(v.tagline, nameX, 86, { size: 8.2, color: MUTED, width: 270 })

    text('Amount paid', LEFT, 60, { size: 8.5, color: MUTED, align: 'right' })
    text(v.amount, LEFT, 71, { font: 'semibold', size: 22, color: PRIMARY, align: 'right' })
    const paidLabel = `Paid on ${v.paidOn}`
    doc.font(FONT.semibold).fontSize(8)
    const paidWidth = doc.widthOfString(paidLabel)
    doc.circle(RIGHT - paidWidth - 7, 102.4, 2.2).fillColor(GREEN).fill()
    text(paidLabel, LEFT, 98.5, { font: 'semibold', size: 8, color: GREEN, align: 'right' })
    rule(123, LEFT, RIGHT, HAIRLINE, 0.75)

    // ── Billed to, and the invoice's own details
    const detailsX = 310
    text('BILLED TO', LEFT, 144, { size: 7.6, color: MUTED, spacing: 0.9, width: 220 })
    text(v.billedTo.name, LEFT, 158, { font: 'semibold', size: 11.5, color: INK, width: 230 })
    let billedBottom = 158 + heightOf(v.billedTo.name, 230, 'semibold', 11.5)
    for (const line of v.billedTo.lines) {
      text(line, LEFT, billedBottom + 4, { size: 9, color: BODY, width: 230 })
      billedBottom += 4 + heightOf(line, 230, 'regular', 9)
    }
    text(v.detailsHeading, detailsX, 144, { size: 7.6, color: MUTED, spacing: 0.9, width: 220 })
    let detailsBottom = 158
    for (const [label, value] of v.details) {
      text(label, detailsX, detailsBottom, { size: 9, color: MUTED, width: 90 })
      text(value, detailsX + 70, detailsBottom, { font: 'medium', size: 9, color: INK, width: RIGHT - detailsX - 70, align: 'right' })
      detailsBottom += 16
    }

    // ── The item
    const tableTop = Math.max(billedBottom, detailsBottom) + 28
    const sacX = 326
    const periodX = 372
    const descWidth = (v.item.sac ? sacX : periodX) - LEFT - 14
    const head = { size: 7.6, color: MUTED, spacing: 0.9 }
    text('DESCRIPTION', LEFT, tableTop, { ...head, width: 120 })
    if (v.item.sac) text('SAC', sacX, tableTop, { ...head, width: 40 })
    if (v.item.period) text('PERIOD', periodX, tableTop, { ...head, width: 100 })
    text('AMOUNT', LEFT, tableTop, { ...head, align: 'right' })
    const headRule = tableTop + 15
    rule(headRule, LEFT, RIGHT, INK, 1)

    const rowTop = headRule + 11
    const titleHeight = heightOf(v.item.title, descWidth, 'semibold', 10)
    text(v.item.title, LEFT, rowTop, { font: 'semibold', size: 10, color: INK, width: descWidth })
    const subtitleHeight = heightOf(v.item.subtitle, descWidth, 'regular', 8.5, 1.5)
    text(v.item.subtitle, LEFT, rowTop + titleHeight + 3, { size: 8.5, color: MUTED, width: descWidth, lineGap: 1.5 })
    if (v.item.sac) text(v.item.sac, sacX, rowTop + 1, { size: 9, color: BODY, width: 40 })
    let periodHeight = 0
    if (v.item.period) {
      const joined = v.item.period.join('\n')
      text(joined, periodX, rowTop + 1, { size: 9, color: BODY, width: 100, lineGap: 1.5 })
      periodHeight = heightOf(joined, 100, 'regular', 9, 1.5)
    }
    text(v.item.amount, LEFT, rowTop + 1, { size: 9.5, color: INK, align: 'right' })
    const rowBottom = rowTop + Math.max(titleHeight + 3 + subtitleHeight, periodHeight, 14)
    rule(rowBottom + 12, LEFT, RIGHT, HAIRLINE, 0.75)

    // ── Total
    const totalX = 335
    let totalTop = rowBottom + 30
    for (const [label, taxAmount] of v.taxRows) {
      text(label, totalX, totalTop, { size: 9.5, color: BODY, width: 110 })
      text(taxAmount, totalX, totalTop, { size: 9.5, color: INK, width: RIGHT - totalX, align: 'right' })
      totalTop += 19
    }
    if (v.taxRows.length > 0) totalTop += 6
    rule(totalTop, totalX, RIGHT, INK, 1)
    text('Total', totalX, totalTop + 11, { font: 'semibold', size: 11, color: PRIMARY, width: 100 })
    text(v.total, totalX, totalTop + 9, { font: 'semibold', size: 13.5, color: PRIMARY, width: RIGHT - totalX, align: 'right' })
    text(v.totalInWords, totalX - 40, totalTop + 33, { size: 8, color: MUTED, width: RIGHT - totalX + 40, align: 'right' })

    // ── Payment
    const payLabelY = totalTop + 33 + 38
    text('PAYMENT', LEFT, payLabelY, { size: 7.6, color: MUTED, spacing: 0.9, width: 120 })
    const boxTop = payLabelY + 17
    const cols = [LEFT + 13, LEFT + 13 + 157.5, LEFT + 13 + 315]
    const cellWidth = 148
    const rows = Math.ceil(v.payment.length / 3)
    const boxHeight = 14 + rows * 40 - 5
    doc.roundedRect(LEFT, boxTop, WIDTH, boxHeight, 7).lineWidth(0.75).strokeColor(BOX).stroke()
    v.payment.forEach((cell, i) => {
      const x = cols[i % 3]!
      const y = boxTop + 13 + Math.floor(i / 3) * 40
      text(cell.label, x, y, { size: 7.8, color: MUTED, width: cellWidth })
      const valueFont = cell.ok ? 'semibold' : 'medium'
      text(cell.value, x, y + 12.5, { font: valueFont, size: 9, color: cell.ok ? GREEN : INK, width: cellWidth })
      if (cell.detail) {
        doc.font(FONT[valueFont]).fontSize(9)
        const offset = doc.widthOfString(cell.value) + 6
        text(cell.detail, x + offset, y + 12.5, { size: 8.6, color: MUTED, width: Math.max(10, cellWidth - offset) })
      }
    })

    // ── What the payment bought
    let contentBottom = boxTop + boxHeight
    if (v.accessNote) {
      const noteTop = contentBottom + 18
      text(v.accessNote, LEFT, noteTop, { size: 9, color: BODY, lineGap: 3 })
      contentBottom = noteTop + heightOf(v.accessNote, WIDTH, 'regular', 9, 3)
    }

    // ── Footer
    const footerTop = Math.max(722, contentBottom + 40)
    const leftWidth = 300
    doc.font(FONT.semibold).fontSize(8.8)
    const nameWidth = doc.widthOfString(v.footer.left.name)
    text(v.footer.left.name, LEFT, footerTop, { font: 'semibold', size: 8.8, color: INK, width: leftWidth })
    if (v.footer.left.rest) text(v.footer.left.rest, LEFT + nameWidth, footerTop, { size: 8.8, color: BODY, width: leftWidth - nameWidth })
    let leftBottom = footerTop + 13
    for (const line of v.footer.left.lines) {
      text(line, LEFT, leftBottom, { size: 8.5, color: BODY, width: leftWidth })
      leftBottom += heightOf(line, leftWidth, 'regular', 8.5) + 4
    }
    let rightBottom = footerTop
    for (const line of v.footer.right) {
      text(line, LEFT, rightBottom, { size: 8.5, color: BODY, align: 'right' })
      rightBottom += 13.5
    }
    let y = Math.max(leftBottom, rightBottom) + 10
    rule(y, LEFT, RIGHT, HAIRLINE, 0.75)
    y += 11
    for (const paragraph of v.footer.fineprint) {
      text(paragraph, LEFT, y, { size: 7.3, color: MUTED, lineGap: 2.2 })
      y += heightOf(paragraph, WIDTH, 'regular', 7.3, 2.2) + 3
    }
    doc.end()
  })
}
