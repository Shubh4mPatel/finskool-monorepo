export interface PlanListItemDTO {
  id: string
  name: string
  durationMonths: number
  price: number
}

export interface CreatePlanOrderResultDTO {
  orderId: string   // Razorpay order id — pass to Razorpay Checkout on the client
  amount: number     // smallest currency unit (paise for INR)
  currency: string
  keyId: string       // Razorpay key id — public, safe to hand to the client SDK
  planId: string
  communityId: string
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

export interface CheckoutExchangeResultDTO {
  sessionToken: string // sent as a Bearer token on verify and status; reaches this one order only
  status: string // created | paid | failed
  orderId: string // Razorpay order id
  amount: number // paise
  currency: string
  keyId: string
  planName: string
  durationMonths: number
  communityName: string
}

export interface CheckoutStatusDTO {
  status: string
  validUntil?: string
}
