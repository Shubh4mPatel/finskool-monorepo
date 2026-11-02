import PDFDocument from 'pdfkit'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { generateInvoiceDownloadUrl, uploadInvoicePdf } from './minio.js'
import { logger } from '../shared/logger.js'
import { hasMemberAccess } from './community-access.js'
import { NotFoundError, ForbiddenError } from '../shared/errors/index.js'
import { loadBillingSettings } from '../modules/services/billing-settings.js'
import { amountInWords, financialYearOf, rupeesToPaise } from '../modules/services/services.billing.js'

export type PlanReceiptRow = Prisma.PlanReceiptGetPayload<object>

interface ReceiptSeller {
  legalName: string
  address: string | null
  gstin: string | null
  contactEmail: string | null
  contactPhone: string | null
  footerNote: string | null
}

interface ReceiptBuyer {
  name: string
  email: string | null
  phone: string
}

const RECEIPT_PREFIX = 'RCPT'

/**
 * Issues the receipt for a paid plan order, once. Safe to call again for the same order (a retry, or the
 * verify call racing the webhook): the second call returns the receipt the first one made. The number comes
 * from its own counter row ("R2026-27") so it never uses up a GST invoice number.
 */
export async function issuePlanReceipt(db: PrismaClient, planOrderId: string): Promise<PlanReceiptRow> {
  const existing = await db.planReceipt.findUnique({ where: { planOrderId } })
  if (existing) return existing

  const order = await db.planOrder.findUniqueOrThrow({
    where: { id: planOrderId },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      community: { select: { name: true } },
      plan: { select: { name: true, durationMonths: true } },
    },
  })
  const settings = await loadBillingSettings(db)
  const seller: ReceiptSeller = {
    legalName: settings.legalName || 'Finskool21',
    address: [settings.addressLine, settings.city, settings.pincode].filter(Boolean).join(', ') || null,
    gstin: settings.gstin || null,
    contactEmail: settings.contactEmail ?? null,
    contactPhone: settings.contactPhone ?? null,
    footerNote: settings.footerNote ?? null,
  }
  const buyer: ReceiptBuyer = { name: order.user.name, email: order.user.email, phone: order.user.phone }
  const issuedAt = new Date()
  const financialYear = financialYearOf(issuedAt)
  const description = `${order.community.name} - ${order.plan.name} (${order.plan.durationMonths} month${order.plan.durationMonths === 1 ? '' : 's'})`

  try {
    return await db.$transaction(async tx => {
      const counter = await tx.$queryRaw<{ last_number: number }[]>`
        INSERT INTO invoice_counters (financial_year, last_number) VALUES (${`R${financialYear}`}, 1)
        ON CONFLICT (financial_year) DO UPDATE SET last_number = invoice_counters.last_number + 1
        RETURNING last_number`
      const sequence = counter[0]!.last_number
      return tx.planReceipt.create({
        data: {
          planOrderId,
          userId: order.userId,
          number: `${RECEIPT_PREFIX}/${financialYear}/${String(sequence).padStart(4, '0')}`,
          financialYear,
          sequence,
          issuedAt,
          seller: seller as unknown as Prisma.InputJsonValue,
          buyer: buyer as unknown as Prisma.InputJsonValue,
          description: description.slice(0, 500),
          amount: order.amount,
          currency: order.currency,
          razorpayPaymentId: order.razorpayPaymentId,
        },
      })
    })
  } catch (err) {
    // Lost the race to a concurrent call for the same order: hand back the winner's receipt.
    const winner = await db.planReceipt.findUnique({ where: { planOrderId } })
    if (winner) return winner
    throw err
  }
}

const INK = '#1a1a1a'
const MUTED = '#666666'
const LINE = '#cfcfcf'
const istDate = (d: Date): string => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' })
const inr = (v: Prisma.Decimal | number | string): string =>
  `INR ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function renderReceiptPdf(receipt: PlanReceiptRow): Promise<Buffer> {
  const seller = receipt.seller as unknown as ReceiptSeller
  const buyer = receipt.buyer as unknown as ReceiptBuyer
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Payment receipt ${receipt.number}`, Author: seller.legalName } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const left = 40
    const right = 555
    const width = right - left

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(seller.legalName, left, 40, { width: 300 })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    if (seller.address) doc.text(seller.address, left, doc.y + 2, { width: 300 })
    if (seller.gstin) doc.text(`GSTIN: ${seller.gstin}`, { width: 300 })
    const contact = [seller.contactEmail, seller.contactPhone].filter(Boolean).join('  |  ')
    if (contact) doc.text(contact, { width: 300 })

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('PAYMENT RECEIPT', 300, 40, { width: right - 300, align: 'right' })
    doc.font('Helvetica').fontSize(10)
    doc.text(`Receipt No: ${receipt.number}`, 300, 70, { width: right - 300, align: 'right' })
    doc.text(`Date: ${istDate(receipt.issuedAt)}`, 300, doc.y + 2, { width: right - 300, align: 'right' })
    if (receipt.razorpayPaymentId) doc.text(`Payment ID: ${receipt.razorpayPaymentId}`, 300, doc.y + 2, { width: right - 300, align: 'right' })

    let y = Math.max(doc.y, 120) + 16
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke()
    y += 12
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('RECEIVED FROM', left, y)
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(buyer.name, left, doc.y + 2, { width: 320 })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    doc.text(buyer.phone, { width: 320 })
    if (buyer.email) doc.text(buyer.email, { width: 320 })

    y = doc.y + 18
    doc.rect(left, y, width, 20).fill('#f1f1f1')
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5)
    doc.text('Description', left + 6, y + 6, { width: 360 })
    doc.text('Amount (INR)', 400, y + 6, { width: right - 400 - 4, align: 'right' })
    y += 28
    doc.font('Helvetica').fontSize(9.5)
    const h = doc.heightOfString(receipt.description, { width: 340 })
    doc.text(receipt.description, left + 6, y, { width: 340 })
    doc.text(Number(receipt.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 400, y, { width: right - 400 - 4, align: 'right' })
    y += Math.max(h, 14) + 10
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke()

    y += 12
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total paid', 340, y, { width: 100 })
    doc.text(inr(receipt.amount), 440, y, { width: right - 440, align: 'right' })
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Amount in words', left, y + 26)
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(amountInWords(rupeesToPaise(receipt.amount.toString())), left, doc.y + 2, { width })

    const footerY = Math.max(doc.y + 40, 700)
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    doc.text('Amount paid is inclusive of applicable taxes.', left, footerY, { width })
    if (seller.footerNote) doc.text(seller.footerNote, left, doc.y + 4, { width })
    doc.text('This is a computer-generated receipt and does not require a signature.', left, doc.y + 4, { width })
    doc.end()
  })
}

const pdfFileName = (r: Pick<PlanReceiptRow, 'number'>): string => `${r.number.replace(/\//g, '-')}.pdf`

/** Renders and stores the PDF once (also called on demand, so a crash after payment never leaves a receipt without its file). */
export async function ensureReceiptPdf(db: PrismaClient, receiptId: string): Promise<string> {
  const receipt = await db.planReceipt.findUniqueOrThrow({ where: { id: receiptId } })
  if (receipt.pdfObjectKey) return receipt.pdfObjectKey
  const pdf = await renderReceiptPdf(receipt)
  const objectKey = `receipts/${receipt.financialYear}/${pdfFileName(receipt)}`
  await uploadInvoicePdf(objectKey, pdf)
  await db.planReceipt.update({ where: { id: receiptId }, data: { pdfObjectKey: objectKey } })
  return objectKey
}

export function renderReceiptInBackground(db: PrismaClient, receiptId: string): void {
  ensureReceiptPdf(db, receiptId).catch(err => logger.error({ err, receiptId }, 'receipt: background PDF render failed'))
}

export async function getReceiptDownloadUrl(db: PrismaClient, userId: string, receiptId: string): Promise<{ url: string; fileName: string } | null> {
  const receipt = await db.planReceipt.findFirst({ where: { id: receiptId, userId }, select: { id: true, number: true } })
  if (!receipt) return null
  const objectKey = await ensureReceiptPdf(db, receipt.id)
  const fileName = pdfFileName(receipt)
  return { url: await generateInvoiceDownloadUrl(objectKey, fileName), fileName }
}

export async function listReceipts(db: PrismaClient, userId: string) {
  const rows = await db.planReceipt.findMany({
    where: { userId },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: { id: true, number: true, issuedAt: true, description: true, amount: true, currency: true },
  })
  return rows.map(r => ({ id: r.id, number: r.number, issuedAt: r.issuedAt.toISOString(), description: r.description, amount: Number(r.amount), currency: r.currency }))
}

/** Receipts of one member, for an admin who is allowed to see that member (same rule as the member profile). */
export async function listReceiptsForAdmin(db: PrismaClient, accessibleCommunityIds: string[] | null, userId: string) {
  if (!(await hasMemberAccess(db, accessibleCommunityIds, userId))) throw new ForbiddenError('You do not have access to this member', 'MEMBER_ACCESS_DENIED')
  return listReceipts(db, userId)
}

export async function getReceiptDownloadUrlForAdmin(db: PrismaClient, accessibleCommunityIds: string[] | null, receiptId: string): Promise<{ url: string; fileName: string }> {
  const receipt = await db.planReceipt.findUnique({ where: { id: receiptId }, select: { id: true, number: true, userId: true } })
  if (!receipt) throw new NotFoundError('Receipt not found')
  if (!(await hasMemberAccess(db, accessibleCommunityIds, receipt.userId))) throw new ForbiddenError('You do not have access to this member', 'MEMBER_ACCESS_DENIED')
  const objectKey = await ensureReceiptPdf(db, receipt.id)
  const fileName = pdfFileName(receipt)
  return { url: await generateInvoiceDownloadUrl(objectKey, fileName), fileName }
}
