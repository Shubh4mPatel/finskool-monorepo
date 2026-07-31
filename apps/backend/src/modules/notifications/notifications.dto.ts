export const NotificationType = {
  Post: 'post',
  Thread: 'thread',
  Recommendation: 'recommendation',
  SubscriptionExtended: 'subscription-extended',
  CommunityAdded: 'community-added',
  NewMemberRegistered: 'new-member-registered',
  ImportComplete: 'import-complete',
  NewMemberReply: 'new-member-reply',
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
