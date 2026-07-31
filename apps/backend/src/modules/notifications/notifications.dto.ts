export const NotificationType = {
  Post: 'post',
  Thread: 'thread',
  Recommendation: 'recommendation',
  SubscriptionExtended: 'subscription-extended',
  CommunityAdded: 'community-added',
  NewMemberRegistered: 'new-member-registered',
  ImportComplete: 'import-complete',
  NewMemberReply: 'new-member-reply',
  SubscriptionExpiring7Days: 'subscription-expiring-7-days',
  SubscriptionExpiring1Day: 'subscription-expiring-1-day',
  SubscriptionExpired: 'subscription-expired',
  AdminUnrepliedDigest: 'admin-unreplied-digest',
  AdminExpiryReport: 'admin-expiry-report',
} as const

export interface NotificationItemDTO {
  id: string
  communityId: string
  type: string
  title: string
  message: string
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
