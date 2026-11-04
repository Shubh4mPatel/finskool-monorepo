import type { PrismaClient } from '../src/generated/prisma/client.js'

/**
 * The reaction types, in the order the app shows them. This list is the source of truth: the migration
 * 20261105100000_reaction_types_v2 brings an existing database to this state, `syncReactionTypes` (run by
 * `npm run db:seed:reactions`) re-applies it by hand, and a test checks that both agree.
 *
 * Ids are stable and never reused. The first three keep the ids they always had (an app that still has 1, 2 and 3
 * hard-coded keeps meaning the same thing); Insightful and Celebrate are new rows. The old Wow (4), Sad (5) and
 * Angry (6) are gone, and an app that still sends those ids gets "Invalid reaction type".
 */
export const REACTION_TYPES = [
  { id: 1, name: 'like', emoji: '👍', sortOrder: 1 },
  { id: 2, name: 'love', emoji: '❤️', sortOrder: 2 },
  { id: 7, name: 'insightful', emoji: '💡', sortOrder: 3 },
  { id: 3, name: 'haha', emoji: '😂', sortOrder: 4 },
  { id: 8, name: 'celebrate', emoji: '👏', sortOrder: 5 },
] as const

export interface ReactionSyncResult {
  /** Types that were not in the list and have been removed. */
  removedTypes: string[]
  /** Member reactions of those types that were deleted with them. */
  removedReactions: number
}

/**
 * Brings the `reaction_types` table to exactly REACTION_TYPES. Types that are no longer listed are removed along with
 * the reactions members left with them, and the counts on the posts those reactions were on are recalculated.
 * Safe to run any number of times: a second run changes nothing.
 */
export async function syncReactionTypes(prisma: PrismaClient): Promise<ReactionSyncResult> {
  const keep = REACTION_TYPES.map(t => t.id) as number[]
  const stale = await prisma.reactionType.findMany({ where: { id: { notIn: keep } }, select: { id: true, name: true } })

  return prisma.$transaction(async tx => {
    let removedReactions = 0
    if (stale.length > 0) {
      const ids = stale.map(t => t.id)
      removedReactions = (await tx.reaction.deleteMany({ where: { reactionTypeId: { in: ids } } })).count
      await tx.reactionType.deleteMany({ where: { id: { in: ids } } })
    }
    for (const t of REACTION_TYPES) {
      await tx.reactionType.upsert({ where: { id: t.id }, update: { name: t.name, emoji: t.emoji, sortOrder: t.sortOrder }, create: t })
    }
    if (stale.length > 0) {
      // Posts whose stored summary still mentions a removed type: rebuild the summary from the reactions that remain.
      await tx.$executeRaw`
        UPDATE "posts" p SET "reaction_counts" = (
          SELECT COALESCE(jsonb_object_agg(rt."name", c."n"), '{}'::jsonb)
          FROM (SELECT "reaction_type_id", count(*) AS "n" FROM "reactions" WHERE "post_id" = p."id" GROUP BY "reaction_type_id") c
          JOIN "reaction_types" rt ON rt."id" = c."reaction_type_id"
        )
        WHERE p."reaction_counts" ?| ${stale.map(t => t.name)}::text[]`
    }
    return { removedTypes: stale.map(t => t.name), removedReactions }
  })
}
