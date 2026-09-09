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
