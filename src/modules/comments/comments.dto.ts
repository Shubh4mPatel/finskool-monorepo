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

export interface CommentTreeDTO {
  id: string
  content: string
  author: CommentAuthorDTO
  depth: number
  createdAt: Date
  replies: CommentTreeDTO[]
}

export interface CommentListDTO {
  comments: CommentTreeDTO[]
  nextCursor: string | null
  hasMore: boolean
}
