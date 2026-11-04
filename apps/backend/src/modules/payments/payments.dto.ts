export interface PlanListItemDTO {
  id: string
  name: string
  durationMonths: number
  /** What the plan costs before GST: the price the admin set. */
  price: number
  /** The GST added on top, in percent. 0 when none is added. */
  gstRatePercent: number
  /** The GST in rupees. */
  gstAmount: number
  /** What the member pays: `price` plus `gstAmount`. Show this one as the amount to pay. */
  totalAmount: number
}

export interface CreatePlanOrderResultDTO {
  orderId: string   // Razorpay order id — pass to Razorpay Checkout on the client
  amount: number     // smallest currency unit (paise for INR): the total Razorpay charges, GST included
  currency: string
  keyId: string       // Razorpay key id — public, safe to hand to the client SDK
  planId: string
  communityId: string
  baseAmount: number     // paise: the plan's price before GST
  gstAmount: number      // paise: the GST added on top (0 when none)
  gstRatePercent: number // 0 when no GST is added
}

export interface VerifyPlanPaymentDTO {
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}

export interface VerifyPlanPaymentResultDTO {
  subscriptionId: string
  communityId: string
  planId: string
  payment: number
  validUntil: string   // ISO date string YYYY-MM-DD
  isActive: boolean
}

export interface CheckoutSessionResultDTO {
  checkoutUrl: string // the webview opens this; the one-time token is in its fragment
  expiresInSeconds: number
}

/** What the payment page shows about the community being bought: who it is and what the member gets. */
export interface CheckoutCommunityDTO {
  name: string
  description: string | null
  /** A short category label such as "Short Term Investment". */
  type: string | null
  tags: string[]
  coverImageUrl: string | null
  badgeUrl: string | null
  /** The "What you get" points the admin wrote for the community. Empty when none were written. */
  whatsIncluded: string[]
  /** Members with access right now. */
  memberCount: number
}

export interface CheckoutExchangeResultDTO {
  sessionToken: string // sent as a Bearer token on verify and status; reaches this one order only
  status: string // created | paid | failed
  orderId: string // Razorpay order id
  amount: number // paise: the total, GST included
  baseAmount: number // paise: the plan's price before GST
  gstAmount: number // paise (0 when no GST is added)
  gstRatePercent: number
  currency: string
  keyId: string
  planName: string
  durationMonths: number
  communityName: string
  community: CheckoutCommunityDTO
}

export interface CheckoutStatusDTO {
  status: string
  validUntil?: string
}
