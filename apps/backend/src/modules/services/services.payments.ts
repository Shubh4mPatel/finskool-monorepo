import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { env } from '../../config/env.js'
import { getAllAdminIds } from '../../lib/community-access.js'
import { publishServiceEvent } from '../../lib/live-tickets-feed.js'
import { notificationsQueue, SERVICE_INVOICE_EMAIL_JOB } from '../../lib/queue.js'
import { getRazorpayClient, verifyPaymentSignature, verifyWebhookSignature } from '../../lib/razorpay.js'
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import { isBillingConfigured, loadBillingSettings } from './billing-settings.js'
import type { MemberServiceRequestDTO, PayOrderDTO } from './services.dto.js'
import { financialYearOf, rupeesToPaise } from './services.billing.js'
import { buildInvoiceData, renderInvoiceInBackground, toInvoiceBuyer } from './services.invoice.js'
import type { MemberBilling } from './services.invoice.js'
import type { PayQuoteDTO, VerifyPaymentDTO } from './services.validator.js'
import {
  effectiveQuoteStatus,
  isUniqueViolation,
  mapMemberRequest,
  mapMessage,
  messageInclude,
  requestInclude,
  requestLabel,
  requestSummary,
} from './services.shared.js'

export interface SettleInput {
  razorpayOrderId: string
  razorpayPaymentId: string
  // What Razorpay says was paid, in paise. null on the verify path (the app only sends ids and a
  // signature), where the order's own amount is used.
  amountPaise: number | null
  currency?: string | undefined
  method?: string | null | undefined
  raw?: unknown
  source: 'verify' | 'webhook'
}

export type SettleOutcome = 'settled' | 'already_settled' | 'flagged' | 'unknown_order'

export interface SettleResult {
  outcome: SettleOutcome
  requestId?: string
}

const REVIEW_MESSAGE =
  'We received a payment that could not be matched to your current quote. Our team will review it and be in touch.'

/**
 * Razorpay orders, payments and the one place a payment turns into a paid service request.
 *
 * `settle()` is called by BOTH the app's verify call and Razorpay's webhook. Whichever arrives first
 * does the work; the other finds the order already paid and does nothing — each path is the
 * other's fallback.
 */
export class ServicePaymentsService {
  constructor(private readonly db: PrismaClient) {}

  // ─── Start a payment ──────────────────────────────────────────────────────

  async createOrder(userId: string, requestId: string, quoteId: string, billing: PayQuoteDTO['billing']): Promise<PayOrderDTO> {
    const request = await this.db.serviceRequest.findFirst({ where: { id: requestId, userId }, select: { id: true, status: true } })
    if (!request) throw new NotFoundError('Service request not found')
    if (request.status === 'closed') throw new ConflictError('This request is closed', 'SERVICE_CLOSED')
    if (request.status === 'paid') throw new ConflictError('This request is already paid', 'SERVICE_ALREADY_PAID')
    if (request.status !== 'quote_sent') throw new ConflictError('There is no quote to pay right now', 'QUOTE_NOT_PAYABLE')

    const quote = await this.db.serviceQuote.findFirst({ where: { id: quoteId, requestId } })
    if (!quote) throw new NotFoundError('Quote not found')
    const status = effectiveQuoteStatus(quote)
    if (status === 'expired') throw new ConflictError('This quote has expired — ask for a new one', 'QUOTE_EXPIRED')
    if (status !== 'active') throw new ConflictError('This quote can no longer be paid', 'QUOTE_NOT_PAYABLE')

    const settings = await loadBillingSettings(this.db)
    if (!isBillingConfigured(settings)) {
      throw new ConflictError('Payments are not set up yet', 'BILLING_NOT_CONFIGURED')
    }
    if (!env.razorpay.keyId || !env.razorpay.keySecret) {
      throw new AppError(503, 'Payments are not available right now', 'PAYMENTS_NOT_CONFIGURED')
    }

    // Record the billing details and that payment has started, only while the quote is still
    // active and unexpired: this is what makes the admin's "replace?" warning and the expiry
    // sweep's grace window work.
    const marked = await this.db.serviceQuote.updateMany({
      where: { id: quote.id, status: 'active', expiresAt: { gt: new Date() } },
      data: { billing: billing as unknown as Prisma.InputJsonValue, paymentStartedAt: new Date() },
    })
    if (marked.count === 0) throw new ConflictError('This quote can no longer be paid', 'QUOTE_NOT_PAYABLE')

    const unpaid = () =>
      this.db.razorpayOrder.findFirst({ where: { purpose: 'service_quote', referenceId: quote.id, status: 'created' } })
    let order = await unpaid()
    if (!order) {
      const amountPaise = rupeesToPaise(quote.totalAmount.toString())
      const receipt = `svcq_${quote.id.replace(/-/g, '').slice(0, 12)}_${quote.version}`
      const notes = { purpose: 'service_quote', quoteId: quote.id, requestId, userId }
      let gatewayOrderId: string
      try {
        const created = await getRazorpayClient().orders.create({ amount: amountPaise, currency: 'INR', receipt, notes })
        gatewayOrderId = created.id
      } catch (err) {
        logger.error({ err, quoteId: quote.id }, 'services.payments: razorpay order creation failed')
        throw new AppError(502, 'Could not start the payment. Please try again.', 'PAYMENT_GATEWAY_ERROR')
      }
      try {
        order = await this.db.razorpayOrder.create({
          data: {
            razorpayOrderId: gatewayOrderId,
            purpose: 'service_quote',
            referenceId: quote.id,
            userId,
            amount: quote.totalAmount,
            currency: 'INR',
            receipt,
            notes,
          },
        })
      } catch (err) {
        // Two taps raced: only one unpaid order per quote is allowed, so share the winner's. The
        // loser's gateway order was never handed out and can never be paid.
        if (!isUniqueViolation(err)) throw err
        order = await unpaid()
        if (!order) throw err
      }
    }

    logger.info({ userId, requestId, quoteId: quote.id, razorpayOrderId: order.razorpayOrderId }, 'services.payments: order ready')
    return {
      orderId: order.razorpayOrderId,
      amount: rupeesToPaise(order.amount.toString()),
      currency: 'INR',
      keyId: env.razorpay.keyId,
      quoteId: quote.id,
      requestId,
    }
  }

  // ─── Path 1: the app confirms ─────────────────────────────────────────────

  async verify(userId: string, requestId: string, dto: VerifyPaymentDTO): Promise<MemberServiceRequestDTO> {
    const order = await this.db.razorpayOrder.findUnique({ where: { razorpayOrderId: dto.razorpayOrderId } })
    if (!order || order.userId !== userId || order.purpose !== 'service_quote') throw new NotFoundError('Order not found')
    const quote = await this.db.serviceQuote.findUnique({ where: { id: order.referenceId }, select: { requestId: true } })
    if (!quote || quote.requestId !== requestId) throw new NotFoundError('Order not found')

    if (!verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature)) {
      logger.error({ userId, requestId, razorpayOrderId: dto.razorpayOrderId }, 'services.payments.verify: signature mismatch')
      throw new BadRequestError('Payment verification failed', 'PAYMENT_SIGNATURE_INVALID')
    }

    await this.settle({
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      amountPaise: null,
      source: 'verify',
    })
    // Same answer whether this call settled it, the webhook already had, or it is a retry.
    const fresh = await this.db.serviceRequest.findFirstOrThrow({ where: { id: requestId, userId }, include: requestInclude })
    return mapMemberRequest(fresh)
  }

  // ─── Path 2: Razorpay confirms ────────────────────────────────────────────

  /**
   * Handles one webhook delivery. `status` is what to answer Razorpay with: anything but 2xx makes
   * it retry (for up to 24 hours), so only genuine processing failures return 5xx.
   */
  async handleWebhook(rawBody: Buffer, signature: string, eventIdHeader: string | undefined): Promise<{ status: number; message: string }> {
    // An unsigned or wrongly signed request is not stored: nothing from an unauthenticated caller goes into the database.
    if (!verifyWebhookSignature(rawBody, signature)) {
      logger.warn('services.payments.webhook: bad or missing signature')
      return { status: 400, message: 'Invalid signature' }
    }

    let payload: Record<string, any>
    try {
      payload = JSON.parse(rawBody.toString('utf8'))
    } catch {
      return { status: 400, message: 'Invalid JSON' }
    }
    const eventType = typeof payload['event'] === 'string' ? (payload['event'] as string) : 'unknown'
    // Razorpay retries a delivery with the same id; fall back to a body hash if the header is ever absent.
    const eventId = (eventIdHeader?.trim() || `sha256:${createHash('sha256').update(rawBody).digest('hex')}`).slice(0, 100)

    let existing = await this.db.razorpayWebhookEvent.findUnique({ where: { razorpayEventId: eventId } })
    if (existing?.processedAt) return { status: 200, message: 'Already processed' }
    if (!existing) {
      try {
        existing = await this.db.razorpayWebhookEvent.create({
          data: { razorpayEventId: eventId, eventType, payload: payload as Prisma.InputJsonValue, signatureValid: true },
        })
      } catch (err) {
        if (!isUniqueViolation(err)) throw err
        existing = await this.db.razorpayWebhookEvent.findUniqueOrThrow({ where: { razorpayEventId: eventId } })
        if (existing.processedAt) return { status: 200, message: 'Already processed' }
      }
    }

    try {
      await this.processWebhookEvent(eventType, payload)
      await this.db.razorpayWebhookEvent.update({ where: { id: existing.id }, data: { processedAt: new Date(), processingError: null } })
      return { status: 200, message: 'OK' }
    } catch (err) {
      logger.error({ err, eventId, eventType }, 'services.payments.webhook: processing failed')
      await this.db.razorpayWebhookEvent
        .update({ where: { id: existing.id }, data: { processingError: String((err as Error)?.message ?? err).slice(0, 2000) } })
        .catch(() => undefined)
      return { status: 500, message: 'Processing failed' }
    }
  }

  private async processWebhookEvent(eventType: string, payload: Record<string, any>): Promise<void> {
    const payment = payload['payload']?.payment?.entity as Record<string, any> | undefined
    const order = payload['payload']?.order?.entity as Record<string, any> | undefined
    const orderId = (order?.['id'] ?? payment?.['order_id']) as string | undefined
    const paymentId = payment?.['id'] as string | undefined

    if ((eventType === 'order.paid' || eventType === 'payment.captured') && orderId && paymentId) {
      await this.settle({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        amountPaise: typeof payment?.['amount'] === 'number' ? (payment['amount'] as number) : null,
        currency: payment?.['currency'] as string | undefined,
        method: (payment?.['method'] as string | undefined) ?? null,
        raw: payment,
        source: 'webhook',
      })
    } else if (eventType === 'payment.failed' && orderId && paymentId) {
      await this.recordFailedAttempt(orderId, paymentId, payment!)
    }
    // Every other event (authorized, refund.*, plan purchases, …) is stored for the record only.
  }

  private async recordFailedAttempt(razorpayOrderId: string, razorpayPaymentId: string, payment: Record<string, any>): Promise<void> {
    const order = await this.db.razorpayOrder.findUnique({ where: { razorpayOrderId } })
    if (!order) return // not one of ours (e.g. a plan purchase)
    const amount = typeof payment['amount'] === 'number' ? ((payment['amount'] as number) / 100).toFixed(2) : order.amount
    await this.db.razorpayPayment.upsert({
      where: { razorpayPaymentId },
      // A later "captured" must never be downgraded by a late or replayed "failed".
      update: {},
      create: {
        razorpayPaymentId,
        orderId: order.id,
        amount,
        currency: order.currency,
        status: 'failed',
        method: (payment['method'] as string | undefined) ?? null,
        errorCode: (payment['error_code'] as string | undefined) ?? null,
        errorDescription: ((payment['error_description'] as string | undefined) ?? '').slice(0, 500) || null,
        raw: payment as Prisma.InputJsonValue,
      },
    })
  }

  // ─── The one place a payment becomes real ─────────────────────────────────

  async settle(input: SettleInput): Promise<SettleResult> {
    const order = await this.db.razorpayOrder.findUnique({ where: { razorpayOrderId: input.razorpayOrderId } })
    if (!order || order.purpose !== 'service_quote') return { outcome: 'unknown_order' }
    const quoteRef = await this.db.serviceQuote.findUnique({ where: { id: order.referenceId }, select: { requestId: true } })
    if (!quoteRef) return { outcome: 'unknown_order' }

    const orderPaise = rupeesToPaise(order.amount.toString())
    const amountPaise = input.amountPaise ?? orderPaise
    const mismatch = amountPaise !== orderPaise || (input.currency !== undefined && input.currency !== order.currency)
    const requestId = quoteRef.requestId
    const now = new Date()

    const result = await this.db.$transaction(async tx => {
      // Everything that can touch this request (cancel, close, a new quote, the other payment path)
      // takes this row lock first, so the checks below are made against settled state.
      await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${requestId}::uuid FOR UPDATE`

      const payment = await tx.razorpayPayment.upsert({
        where: { razorpayPaymentId: input.razorpayPaymentId },
        create: {
          razorpayPaymentId: input.razorpayPaymentId,
          orderId: order.id,
          amount: (amountPaise / 100).toFixed(2),
          currency: order.currency,
          status: 'captured',
          method: input.method ?? null,
          ...(input.raw ? { raw: input.raw as Prisma.InputJsonValue } : {}),
        },
        update: { status: 'captured', ...(input.method ? { method: input.method } : {}) },
      })

      const freshOrder = await tx.razorpayOrder.findUniqueOrThrow({ where: { id: order.id } })
      if (freshOrder.status === 'paid') return { outcome: 'already_settled' as const, requestId }

      const [quote, request] = await Promise.all([
        tx.serviceQuote.findUniqueOrThrow({ where: { id: order.referenceId } }),
        tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: { service: { select: { title: true } } } }),
      ])
      await tx.razorpayOrder.update({ where: { id: order.id }, data: { status: 'paid', paidAt: now } })

      const flag = async (reason: string, extra: Record<string, unknown> = {}) => {
        await tx.serviceRequest.update({
          where: { id: requestId },
          data: { requiresReview: true, lastMessageAt: now, adminUnreadCount: { increment: 1 } },
        })
        await tx.serviceEvent.create({
          data: {
            requestId,
            type: 'payment_flagged',
            actorId: order.userId,
            meta: { reason, razorpayPaymentId: input.razorpayPaymentId, amountPaise, quoteStatus: quote.status, requestStatus: request.status, ...extra } as Prisma.InputJsonValue,
          },
        })
        const message = await tx.serviceMessage.create({
          data: { requestId, senderId: null, senderRole: 'system', kind: 'system', body: REVIEW_MESSAGE },
          select: { id: true },
        })
        return { outcome: 'flagged' as const, requestId, messageId: message.id }
      }

      if (mismatch) return flag('amount_mismatch', { orderPaise, currency: input.currency ?? null })
      if (request.status !== 'quote_sent' || quote.status !== 'active') {
        return flag('quote_not_payable')
      }

      // ── Valid: the payment is for the payable quote of an open request ──
      await tx.serviceQuote.update({ where: { id: quote.id }, data: { status: 'paid' } })
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'paid', paidAt: now, lastMessageAt: now, adminUnreadCount: { increment: 1 } },
      })
      await tx.razorpayPayment.update({ where: { id: payment.id }, data: { settledVia: input.source } })
      await tx.serviceEvent.create({
        data: {
          requestId,
          type: 'paid',
          actorId: order.userId,
          meta: { quoteId: quote.id, razorpayPaymentId: input.razorpayPaymentId, amountPaise, via: input.source },
        },
      })
      const message = await tx.serviceMessage.create({
        data: { requestId, senderId: null, senderRole: 'system', kind: 'system', body: 'Payment received. Thank you!' },
        select: { id: true },
      })

      // Invoice: allocated here, in the same transaction, so a rollback never burns a number.
      const settings = await loadBillingSettings(tx)
      const billing = quote.billing as unknown as MemberBilling | null
      let invoiceId: string | null = null
      if (isBillingConfigured(settings) && billing) {
        const financialYear = financialYearOf(now)
        const counter = await tx.$queryRaw<{ last_number: number }[]>`
          INSERT INTO invoice_counters (financial_year, last_number) VALUES (${financialYear}, 1)
          ON CONFLICT (financial_year) DO UPDATE SET last_number = invoice_counters.last_number + 1
          RETURNING last_number`
        const invoice = await tx.serviceInvoice.create({
          data: buildInvoiceData({
            requestId,
            quoteId: quote.id,
            paymentId: payment.id,
            settings,
            buyer: toInvoiceBuyer(billing),
            description: `${request.service.title} - Service request ${requestLabel(request.number)}`,
            baseAmount: quote.baseAmount,
            gstAmount: quote.gstAmount,
            gstRatePercent: quote.gstRatePercent,
            totalAmount: quote.totalAmount,
            financialYear,
            sequence: counter[0]!.last_number,
            issuedAt: now,
          }),
          select: { id: true },
        })
        invoiceId = invoice.id
      } else {
        // The money is in and the service is paid, but there is nothing to invoice with: an admin sorts it out.
        await tx.serviceRequest.update({ where: { id: requestId }, data: { requiresReview: true } })
        await tx.serviceEvent.create({
          data: { requestId, type: 'payment_flagged', actorId: order.userId, meta: { reason: 'invoice_not_issued', razorpayPaymentId: input.razorpayPaymentId } },
        })
      }
      return { outcome: 'settled' as const, requestId, messageId: message.id, invoiceId }
    })

    if (result.outcome === 'already_settled') {
      logger.info({ requestId, razorpayPaymentId: input.razorpayPaymentId, source: input.source }, 'services.payments.settle: already settled (no-op)')
      return { outcome: 'already_settled', requestId }
    }

    logger.info({ requestId, outcome: result.outcome, source: input.source, razorpayPaymentId: input.razorpayPaymentId }, 'services.payments.settle: done')
    await this.afterSettle(requestId, result.messageId, result.outcome === 'settled' ? result.invoiceId : null, order.userId)
    return { outcome: result.outcome, requestId }
  }

  /** After the commit: live events, the invoice PDF and the invoice email. None of it can fail the payment. */
  private async afterSettle(requestId: string, messageId: string, invoiceId: string | null, userId: string): Promise<void> {
    try {
      const [fresh, message, adminIds] = await Promise.all([
        this.db.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: requestInclude }),
        this.db.serviceMessage.findUnique({ where: { id: messageId }, include: messageInclude }),
        getAllAdminIds(this.db),
      ])
      const dtoMessage = message ? await mapMessage(message) : null
      const publishFor = (userIds: string[], side: 'member' | 'admin') =>
        Promise.all([
          dtoMessage
            ? publishServiceEvent({ userIds, event: 'service.message', requestId, data: { message: dtoMessage, request: requestSummary(fresh, side) } })
            : Promise.resolve(),
          publishServiceEvent({ userIds, event: 'service.updated', requestId, data: { request: requestSummary(fresh, side) } }),
        ])
      await Promise.all([publishFor([userId], 'member'), publishFor(adminIds, 'admin')])
    } catch (err) {
      logger.error({ err, requestId }, 'services.payments: failed to publish live events')
    }

    if (!invoiceId) return
    renderInvoiceInBackground(this.db, invoiceId)
    try {
      const user = await this.db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
      if (user?.email) {
        await notificationsQueue.add(
          SERVICE_INVOICE_EMAIL_JOB,
          { toEmail: user.email, name: user.name, invoiceId },
          { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: { count: 500 } },
        )
      }
    } catch (err) {
      logger.error({ err, invoiceId }, 'services.payments: failed to enqueue invoice email')
    }
  }
}
