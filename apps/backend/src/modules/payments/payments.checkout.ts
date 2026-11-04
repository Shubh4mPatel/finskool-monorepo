import { createHash, randomBytes } from 'crypto'
import type { PrismaClient } from '../../generated/prisma/client.js'
import redis from '../../lib/redis.js'
import { env } from '../../config/env.js'
import { BadRequestError, TooManyRequestsError, UnauthorizedError } from '../../shared/errors/index.js'
import { logger } from '../../shared/logger.js'
import type { PaymentsService } from './payments.service.js'
import type {
  CheckoutExchangeResultDTO,
  CheckoutSessionResultDTO,
  CheckoutStatusDTO,
  VerifyPlanPaymentResultDTO,
} from './payments.dto.js'

// Buying inside the mobile app's webview. The app's own session id never reaches the page:
//   1. the app (logged in) asks for a checkout session -> the server makes the Razorpay order and a
//      handoff token for it, and the app opens the webview at `<checkout page>#t=<token>`;
//   2. the page trades the token for a session token (the handoff token is burned by that call);
//   3. the page pays and verifies with the session token, which only reaches this one order.
// The webhook grants the plan too if the page never gets to verify (see settlePlanOrder).

// An order made by an earlier tap is reused instead of making a new Razorpay order every time.
const REUSE_ORDER_WITHIN_MS = 15 * 60 * 1000
const MAX_CHECKOUTS_PER_HOUR = 10

const handoffKey = (hash: string) => `pay:handoff:${hash}`
const sessionKey = (hash: string) => `pay:session:${hash}`
const rateKey = (userId: string) => `pay:checkout-rate:${userId}`

const newToken = () => randomBytes(32).toString('base64url')
// Only the hash is stored, so a Redis dump does not hand out usable tokens.
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

interface HandoffPayload {
  planOrderId: string
}

export class PaymentsCheckoutService {
  constructor(
    private readonly db: PrismaClient,
    private readonly payments: PaymentsService,
  ) {}

  async createSession(userId: string, communityId: string, planId: string): Promise<CheckoutSessionResultDTO> {
    const count = await redis.incr(rateKey(userId))
    if (count === 1) await redis.expire(rateKey(userId), 3600)
    logger.info({ userId, communityId, planId, attemptThisHour: count }, 'checkout.createSession: requested')
    if (count > MAX_CHECKOUTS_PER_HOUR) {
      logger.warn({ userId, attemptThisHour: count }, 'checkout.createSession: rate limit hit')
      throw new TooManyRequestsError('Too many checkout attempts — try again later')
    }

    const open = await this.db.planOrder.findFirst({
      where: { userId, communityId, planId, status: 'created', createdAt: { gte: new Date(Date.now() - REUSE_ORDER_WITHIN_MS) } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    let planOrderId = open?.id
    if (planOrderId) logger.info({ userId, planOrderId }, 'checkout.createSession: reusing a recent unpaid order')
    if (!planOrderId) {
      const created = await this.payments.createOrder(userId, communityId, planId)
      const row = await this.db.planOrder.findUniqueOrThrow({ where: { razorpayOrderId: created.orderId }, select: { id: true } })
      planOrderId = row.id
      logger.info({ userId, planOrderId, razorpayOrderId: created.orderId }, 'checkout.createSession: new order created')
    }

    const token = newToken()
    await redis.set(handoffKey(hashOf(token)), JSON.stringify({ planOrderId } satisfies HandoffPayload), 'EX', env.paymentCheckoutTokenTtlSeconds)

    logger.info({ userId, planOrderId, ttlSeconds: env.paymentCheckoutTokenTtlSeconds }, 'checkout.createSession: handoff link issued')
    // In the fragment, so it is never sent to a server or in a Referer header.
    return { checkoutUrl: `${env.paymentCheckoutUrl}#t=${token}`, expiresInSeconds: env.paymentCheckoutTokenTtlSeconds }
  }

  /** Burns the handoff token (GETDEL: a second use finds nothing) and opens a session for that one order. */
  async exchange(handoffToken: string): Promise<CheckoutExchangeResultDTO> {
    const raw = await redis.getdel(handoffKey(hashOf(handoffToken)))
    if (!raw) {
      logger.warn('checkout.exchange: link is unknown, already used or expired')
      throw new UnauthorizedError('This checkout link has expired — go back to the app and try again')
    }
    const { planOrderId } = JSON.parse(raw) as HandoffPayload

    const order = await this.db.planOrder.findUnique({
      where: { id: planOrderId },
      include: { plan: { select: { name: true, durationMonths: true } }, community: { select: { name: true } } },
    })
    if (!order) {
      logger.error({ planOrderId }, 'checkout.exchange: the order behind this link no longer exists')
      throw new UnauthorizedError('This checkout link is no longer valid')
    }
    logger.info({ planOrderId, userId: order.userId, orderStatus: order.status }, 'checkout.exchange: session opened')

    const sessionToken = newToken()
    await redis.set(sessionKey(hashOf(sessionToken)), planOrderId, 'EX', env.paymentSessionTtlSeconds)

    return {
      sessionToken,
      status: order.status,
      orderId: order.razorpayOrderId,
      amount: Math.round(Number(order.amount) * 100),
      // Before GST, the GST on top and its rate, as they were charged. An order with no GST is all base.
      baseAmount: Math.round(Number(order.baseAmount ?? order.amount) * 100),
      gstAmount: Math.round(Number(order.gstAmount ?? 0) * 100),
      gstRatePercent: Number(order.gstRatePercent ?? 0),
      currency: order.currency,
      keyId: env.razorpay.keyId,
      planName: order.plan.name,
      durationMonths: order.plan.durationMonths,
      communityName: order.community.name,
    }
  }

  async verify(sessionToken: string, razorpayPaymentId: string, razorpaySignature: string): Promise<VerifyPlanPaymentResultDTO> {
    // The order comes from the session, never from the request, so a session can only ever settle its own order.
    const order = await this.orderOfSession(sessionToken)
    logger.info({ userId: order.userId, planOrderId: order.id, razorpayOrderId: order.razorpayOrderId, razorpayPaymentId }, 'checkout.verify: confirming payment')
    const result = await this.payments.verifyPayment(order.userId, { razorpayOrderId: order.razorpayOrderId, razorpayPaymentId, razorpaySignature })
    logger.info({ userId: order.userId, planOrderId: order.id }, 'checkout.verify: payment confirmed')
    return result
  }

  /** Lets the page (or the app, once the webview closes) see whether the plan was granted, e.g. by the webhook. */
  async status(sessionToken: string): Promise<CheckoutStatusDTO> {
    const order = await this.orderOfSession(sessionToken)
    if (order.status !== 'paid' || !order.subscriptionId || !order.razorpayPaymentId) return { status: order.status }
    const result = await this.payments.settlePlanOrder(order.id, order.razorpayPaymentId)
    return { status: 'paid', validUntil: result.validUntil }
  }

  private async orderOfSession(sessionToken: string) {
    const planOrderId = await redis.get(sessionKey(hashOf(sessionToken)))
    if (!planOrderId) {
      logger.warn('checkout.session: token is unknown or expired')
      throw new UnauthorizedError('This checkout session has expired')
    }
    const order = await this.db.planOrder.findUnique({ where: { id: planOrderId } })
    if (!order) {
      logger.error({ planOrderId }, 'checkout.session: the order of this session no longer exists')
      throw new BadRequestError('Order not found')
    }
    return order
  }
}
