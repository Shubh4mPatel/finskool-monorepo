export interface ReactionTypeDTO {
  id: number
  name: string
  emoji: string
  sortOrder: number
}

export interface UpsertReactionDTO {
  reactionTypeId: number
}

export interface ReactionResultDTO {
  reactionCounts: Record<string, number>
  myReaction: string | null
}

export interface PostReactionItemDTO {
  userId: string
  userName: string
  userAvatarUrl: string | null
  reactionType: string
  emoji: string
  reactedAt: Date
}

export interface ListPostReactionsResponseDTO {
  reactions: PostReactionItemDTO[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
