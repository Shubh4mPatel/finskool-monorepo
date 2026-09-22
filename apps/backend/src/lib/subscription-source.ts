// Plain VARCHAR + `as const` object — same convention as NotificationType
// (see notifications.dto.ts) and Community.type, not a native Postgres enum.
// Existing Subscription rows predate this field and stay NULL (genuinely
// unknown which category they'd fall into) rather than backfilled with a guess.
export const SubscriptionSource = {
  AdminAdded: 'admin-added',       // addMember / reviveAndAddMember / updateMember's newCommunity branch
  AdminExtended: 'admin-extended', // extendSubscription
  Import: 'import',                // importUsers / importUsersFromJSON (bulk CSV/JSON) — every row, new or overwritten
  FreeSignup: 'free-signup',       // mobile-auth.service.ts finalizeRegistration (auto-subscribe to the free community)
  Self: 'self',                    // self-serve purchase via Razorpay (payments module)
} as const

export type SubscriptionSourceValue = (typeof SubscriptionSource)[keyof typeof SubscriptionSource]
