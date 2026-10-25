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

interface NotificationRow {
  id: string
  communityId: string | null
  type: string
  title: string
  message: string
  data: unknown
  isRead: boolean
  createdAt: Date
  updatedAt: Date
}

/** The inbox item as the apps see it; shared by the REST list and the live mobile socket. */
export function toNotificationItem(n: NotificationRow): NotificationItemDTO {
  return {
    id: n.id,
    communityId: n.communityId,
    type: n.type,
    title: n.title,
    message: n.message,
    data: (n.data as Record<string, string> | null) ?? null,
    isRead: n.isRead,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  }
}
