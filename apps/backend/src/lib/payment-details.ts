import { logger } from '../shared/logger.js'
import { getRazorpayClient } from './razorpay.js'

/**
 * How a plan was paid, as it is printed on the invoice. Kept as a snapshot on the receipt, so the invoice does not
 * depend on Razorpay still answering years later.
 */
export interface PaymentSnapshot {
  /** "UPI", "Card", "Netbanking", ... Null when Razorpay could not be asked. */
  method: string | null
  /** What identifies it without exposing it: "aman.v•••@okhdfcbank", "Visa ••••4242". Null when Razorpay gave nothing. */
  detail: string | null
  /** When Razorpay recorded the payment, ISO. Null when unknown. */
  paidAt: string | null
  /** The Razorpay order the payment belongs to. */
  orderId: string | null
}

/** The part of a Razorpay payment record the invoice uses. */
export interface RazorpayPaymentRecord {
  method?: string | null
  vpa?: string | null
  bank?: string | null
  wallet?: string | null
  card?: { network?: string | null; last4?: string | null } | null
  created_at?: number | null
  order_id?: string | null
}

/**
 * "aman.verma@okhdfcbank" -> "aman.v•••@okhdfcbank": the start of the handle stays so the member knows which one it
 * was, the rest is hidden. Short handles show less, so at least three characters are always hidden.
 */
export function maskUpiId(vpa: string): string {
  const at = vpa.lastIndexOf('@')
  const local = at === -1 ? vpa : vpa.slice(0, at)
  const bank = at === -1 ? '' : vpa.slice(at)
  const visible = Math.min(6, Math.max(1, local.length - 3))
  return `${local.slice(0, visible)}•••${bank}`
}

const METHOD_LABEL: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Netbanking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay Later',
  cardless_emi: 'Cardless EMI',
  bank_transfer: 'Bank transfer',
}

const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** Turns Razorpay's record of a payment into what the invoice prints. */
export function describePayment(record: RazorpayPaymentRecord): PaymentSnapshot {
  const raw = (record.method ?? '').trim().toLowerCase()
  const method = raw ? (METHOD_LABEL[raw] ?? titleCase(raw.replace(/_/g, ' '))) : 'Online payment'

  let detail: string | null = null
  if (raw === 'upi' && record.vpa) detail = maskUpiId(record.vpa)
  else if (raw === 'card' && record.card?.last4) detail = [record.card.network ? titleCase(record.card.network) : null, `••••${record.card.last4}`].filter(Boolean).join(' ')
  else if (raw === 'netbanking' && record.bank) detail = record.bank.toUpperCase()
  else if (raw === 'wallet' && record.wallet) detail = titleCase(record.wallet)

  return {
    method,
    detail,
    paidAt: typeof record.created_at === 'number' && record.created_at > 0 ? new Date(record.created_at * 1000).toISOString() : null,
    orderId: record.order_id ?? null,
  }
}

const LOOKUP_TIMEOUT_MS = 5000

/**
 * Asks Razorpay how a payment was made. Null if it cannot be found out (Razorpay not configured, down, slow, or
 * the id unknown): the invoice is issued either way, just with fewer details.
 */
export async function fetchPaymentSnapshot(razorpayPaymentId: string): Promise<PaymentSnapshot | null> {
  try {
    const lookup = getRazorpayClient().payments.fetch(razorpayPaymentId) as unknown as Promise<RazorpayPaymentRecord>
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Razorpay lookup timed out')), LOOKUP_TIMEOUT_MS).unref())
    return describePayment(await Promise.race([lookup, timeout]))
  } catch (err) {
    logger.warn({ err, razorpayPaymentId }, 'receipt: could not look up how the payment was made')
    return null
  }
}
