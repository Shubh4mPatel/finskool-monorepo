export const NotificationType = { Post: 'post', Thread: 'thread' } as const

export interface NotificationItemDTO {
  id: string
  communityId: string
  type: string
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
