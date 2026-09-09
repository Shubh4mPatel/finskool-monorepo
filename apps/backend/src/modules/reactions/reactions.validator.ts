import { z } from 'zod'

export const upsertReactionSchema = z.object({
  reactionTypeId: z.coerce.number().int().min(1),
})
