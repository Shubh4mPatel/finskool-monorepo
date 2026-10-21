export const NotificationType = {
  Post: 'post',
  Thread: 'thread',
  Recommendation: 'recommendation',
  SubscriptionExtended: 'subscription-extended',
  CommunityAdded: 'community-added',
  NewMemberRegistered: 'new-member-registered',
  ImportComplete: 'import-complete',
  NewMemberReply: 'new-member-reply',
  Reaction: 'reaction',
  SubscriptionExpiring7Days: 'subscription-expiring-7-days',
  SubscriptionExpiring1Day: 'subscription-expiring-1-day',
  SubscriptionExpired: 'subscription-expired',
  AdminUnrepliedDigest: 'admin-unreplied-digest',
  AdminExpiryReport: 'admin-expiry-report',
  // One inbox row per ticket / service request, refreshed on every admin action.
  TicketUpdate: 'ticket-update',
  ServiceUpdate: 'service-update',
} as const

export interface NotificationItemDTO {
  id: string
  communityId: string | null
  type: string
  title: string
  message: string
  // Routing info for the app, e.g. { type: 'ticket', id: '...' }.
  data: Record<string, string> | null
  isRead: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ListNotificationsResponseDTO {
  notifications: NotificationItemDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
