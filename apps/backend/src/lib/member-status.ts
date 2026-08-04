import type { MemberStatus } from '../modules/admin/admin.dto.js'

// Single source of truth for the deleted > suspended > pending > expired > registered
// precedence used whenever a lifecycle transition needs to compute (rather than just
// hardcode) a member's next status — currently only revokeSuspension, since reinstating
// doesn't by itself say whether the member's subscription is still valid or has lapsed.
export function computeMemberStatus(params: {
  approvedPhoneActive: boolean
  registered: boolean
  suspended: boolean
  currentSubscription: { isActive: boolean; validUntil: Date } | null
  today: Date
}): MemberStatus {
  const { approvedPhoneActive, registered, suspended, currentSubscription, today } = params
  if (!approvedPhoneActive) return 'deleted'
  if (suspended) return 'suspended'
  if (!registered) return 'pending'
  if (currentSubscription && (!currentSubscription.isActive || currentSubscription.validUntil < today)) return 'expired'
  return 'registered'
}
