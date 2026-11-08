import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import { generateInvoiceDownloadUrl, uploadInvoicePdf } from './minio.js'
import { logger } from '../shared/logger.js'
import { hasMemberAccess } from './community-access.js'
import { NotFoundError, ForbiddenError } from '../shared/errors/index.js'
import { loadBillingSettings } from '../modules/services/billing-settings.js'
import { financialYearOf, formatInvoiceNumber, gstStateName, paiseToDecimal, rupeesToPaise, splitGst } from '../modules/services/services.billing.js'
import { fetchPaymentSnapshot, type PaymentSnapshot } from './payment-details.js'
import { renderReceiptPdf, type ReceiptBuyer, type ReceiptSeller } from './receipt-pdf.js'
import type { PaidCommunityInvoiceDTO } from '../modules/auth/auth.dto.js'

export { renderReceiptPdf }
export type PlanReceiptRow = Prisma.PlanReceiptGetPayload<object>

/** The days of access a payment bought, first and last day included. */
export interface ReceiptPeriod {
  start: Date
  end: Date
}

const RECEIPT_PREFIX = 'RCPT'

/**
 * Issues the receipt for a paid plan order, once. Safe to call again for the same order (a retry, or the
 * verify call racing the webhook): the second call returns the receipt the first one made.
 *
 * When GST was added on top of the plan's price (the order remembers the split it charged) this is a GST tax invoice,
 * numbered in the same series as the service invoices ("FS/2026-27/0185"), with the tax split into CGST + SGST (or
 * IGST). Otherwise it is a plain receipt in its own series ("RCPT/2026-27/0003", counter row "R2026-27"), which never
 * uses up a GST invoice number.
 */
export async function issuePlanReceipt(db: PrismaClient, planOrderId: string, period?: ReceiptPeriod): Promise<PlanReceiptRow> {
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
    proprietorName: settings.proprietorName ?? null,
    pan: settings.pan ?? null,
    sebiRegistrationNo: settings.sebiRegistrationNo ?? null,
    website: settings.website ?? null,
    sacCode: settings.sacCode ?? null,
  }
  // The days of access this payment bought. The caller knows them exactly (a renewal starts when the old access ends);
  // failing that, the subscription it created says when it started and when it runs out.
  const subscription = period || !order.subscriptionId ? null : await db.subscription.findUnique({ where: { id: order.subscriptionId }, select: { paidOn: true, validUntil: true } })
  const access: ReceiptPeriod | null = period ?? (subscription?.validUntil ? { start: subscription.paidOn ?? subscription.validUntil, end: subscription.validUntil } : null)
  // How it was paid, asked of Razorpay before the database transaction so a slow answer never holds a lock. If it
  // cannot be had the invoice just has fewer details: the order id we already hold is kept.
  const looked = order.razorpayPaymentId ? await fetchPaymentSnapshot(order.razorpayPaymentId) : null
  const payment: PaymentSnapshot = { method: null, detail: null, paidAt: null, ...looked, orderId: looked?.orderId ?? order.razorpayOrderId }
  // GST on top of the price: split it the way the quote invoices do. A member's state is not collected, so the sale is
  // taken to be made in the seller's own state (where the supplier's location decides when the recipient's is not on
  // record), which is CGST + SGST.
  const taxed = order.baseAmount !== null && order.gstAmount !== null
  const sellerState = settings.stateCode ?? ''
  const split = taxed ? splitGst(rupeesToPaise(order.gstAmount!.toString()), sellerState, sellerState) : null
  const buyer: ReceiptBuyer = {
    name: order.user.name,
    email: order.user.email,
    phone: order.user.phone,
    ...(taxed && sellerState ? { stateCode: sellerState, stateName: gstStateName(sellerState) } : {}),
  }
  const issuedAt = new Date()
  const financialYear = financialYearOf(issuedAt)
  const description = `${order.community.name} - ${order.plan.name} (${order.plan.durationMonths} month${order.plan.durationMonths === 1 ? '' : 's'})`

  try {
    return await db.$transaction(async tx => {
      // Tax invoices count in the service invoices' series (one consecutive run for the year); plain receipts in theirs.
      const counter = await tx.$queryRaw<{ last_number: number }[]>`
        INSERT INTO invoice_counters (financial_year, last_number) VALUES (${taxed ? financialYear : `R${financialYear}`}, 1)
        ON CONFLICT (financial_year) DO UPDATE SET last_number = invoice_counters.last_number + 1
        RETURNING last_number`
      const sequence = counter[0]!.last_number
      return tx.planReceipt.create({
        data: {
          planOrderId,
          userId: order.userId,
          number: taxed ? formatInvoiceNumber(settings.invoicePrefix, financialYear, sequence) : `${RECEIPT_PREFIX}/${financialYear}/${String(sequence).padStart(4, '0')}`,
          financialYear,
          sequence,
          issuedAt,
          seller: seller as unknown as Prisma.InputJsonValue,
          buyer: buyer as unknown as Prisma.InputJsonValue,
          description: description.slice(0, 500),
          amount: order.amount,
          currency: order.currency,
          razorpayPaymentId: order.razorpayPaymentId,
          ...(split
            ? {
                taxableValue: order.baseAmount,
                gstRatePercent: order.gstRatePercent,
                cgst: paiseToDecimal(split.cgstPaise),
                sgst: paiseToDecimal(split.sgstPaise),
                igst: paiseToDecimal(split.igstPaise),
              }
            : {}),
          ...(access ? { periodStart: access.start, periodEnd: access.end } : {}),
          payment: payment as unknown as Prisma.InputJsonValue,
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
    select: { id: true, number: true, issuedAt: true, description: true, amount: true, currency: true, planOrder: { select: { communityId: true } } },
  })
  return rows.map(r => ({
    id: r.id,
    number: r.number,
    issuedAt: r.issuedAt.toISOString(),
    description: r.description,
    amount: Number(r.amount),
    currency: r.currency,
    // Which community it was for, so the app can put each invoice next to the community it paid for.
    communityId: r.planOrder.communityId,
  }))
}

/**
 * The invoice of the member's latest purchase of each given community, with a signed link to its PDF. A community the
 * member never paid for through the app (an admin added them) has none. A link that cannot be made right now (the
 * file store is down) comes back as null rather than failing the call it is part of; the member can still fetch it
 * from the receipts download endpoint.
 */
export async function latestInvoiceByCommunity(db: PrismaClient, userId: string, communityIds: string[]): Promise<Map<string, PaidCommunityInvoiceDTO>> {
  if (communityIds.length === 0) return new Map()
  const rows = await db.planReceipt.findMany({
    where: { userId, planOrder: { communityId: { in: communityIds } } },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, number: true, issuedAt: true, amount: true, currency: true, pdfObjectKey: true, planOrder: { select: { communityId: true } } },
  })
  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!latest.has(r.planOrder.communityId)) latest.set(r.planOrder.communityId, r)

  const invoices = await Promise.all(
    [...latest].map(async ([communityId, r]): Promise<[string, PaidCommunityInvoiceDTO]> => {
      const fileName = pdfFileName(r)
      let downloadUrl: string | null = null
      try {
        // The PDF is stored right after the purchase; if that has not happened yet it is made now.
        downloadUrl = await generateInvoiceDownloadUrl(r.pdfObjectKey ?? (await ensureReceiptPdf(db, r.id)), fileName)
      } catch (err) {
        logger.warn({ err, receiptId: r.id }, 'receipt: could not make the download link')
      }
      return [communityId, { id: r.id, number: r.number, issuedAt: r.issuedAt.toISOString(), amount: Number(r.amount), currency: r.currency, downloadUrl, fileName }]
    }),
  )
  return new Map(invoices)
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
