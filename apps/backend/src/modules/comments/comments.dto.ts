export interface CreateCommentDTO {
  content: string
  parentCommentId?: string | undefined
}

export interface CommentAuthorDTO {
  id: string
  name: string
  role: string
  avatarUrl: string | null
}

export interface CommentNotificationRefDTO {
  id: string
  isReplied: boolean
}

export interface CommentTreeDTO {
  id: string
  content: string
  author: CommentAuthorDTO
  depth: number
  createdAt: Date
  notification: CommentNotificationRefDTO | null
  replies: CommentTreeDTO[]
}

export interface CommentListDTO {
  comments: CommentTreeDTO[]
  nextCursor: string | null
  hasMore: boolean
}
