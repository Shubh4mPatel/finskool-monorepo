import Razorpay from 'razorpay'
import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../config/env.js'

let client: Razorpay | null = null

/**
 * Lazy singleton. The Razorpay SDK's constructor throws synchronously if
 * key_id is missing — constructing it eagerly at module load would crash
 * the entire process on any boot where Razorpay isn't configured yet (local
 * dev, CI, a fresh deploy), not just the payments feature. Deferring
 * construction to first actual use means only a real payment request fails
 * until the keys are set.
 */
export function getRazorpayClient(): Razorpay {
  if (!client) {
    if (!env.razorpay.keyId || !env.razorpay.keySecret) {
      throw new Error('Razorpay is not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET')
    }
    client = new Razorpay({ key_id: env.razorpay.keyId, key_secret: env.razorpay.keySecret })
  }
  return client
}

/**
 * Standard Razorpay Orders verification: HMAC-SHA256 of `orderId|paymentId`
 * keyed with the account secret must equal the signature the client got back
 * from Checkout. Constant-time compare so this can't leak timing info about
 * how much of the signature matched.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', env.razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  const givenBuf = Buffer.from(signature, 'hex')
  if (expectedBuf.length !== givenBuf.length) return false
  return timingSafeEqual(expectedBuf, givenBuf)
}
