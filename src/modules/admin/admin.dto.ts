export type DuplicateStrategy = 'skip' | 'overwrite'

export interface ImportErrorDTO {
  row: number
  phone: string
  reason: string
}

export interface ImportSummaryDTO {
  total: number
  created: number
  updated: number
  skipped: number
  errors: ImportErrorDTO[]
}

export interface CommentNotificationAuthorDTO {
  id: string
  name: string
  avatarUrl: string | null
}

export interface CommentNotificationPostDTO {
  id: string
  title: string
}

export interface CommentNotificationItemDTO {
  id: string
  isReplied: boolean
  repliedAt: Date | null
  createdAt: Date
  comment: {
    id: string
    content: string
    author: CommentNotificationAuthorDTO
    createdAt: Date
  }
  post: CommentNotificationPostDTO
}

export interface CommentNotificationListDTO {
  notifications: CommentNotificationItemDTO[]
  nextCursor: string | null
  hasMore: boolean
}
