-- Reaction types become: Like, Love, Insightful, Haha, Celebrate (prisma/reaction-types.ts is the same list).
--
-- This is the "seed" for deployed databases: `prisma migrate deploy` runs it once on the next deploy (the container
-- entrypoint does that on every start), so no manual step is needed. It is also safe to run again.
--
-- What it does:
--   * Wow (4), Sad (5) and Angry (6) are removed together with every reaction members left with them.
--   * Like (1), Love (2) and Haha (3) keep their ids and reactions; only the display order changes.
--   * Insightful (7) and Celebrate (8) are added.
--   * The reaction summary stored on a post is rebuilt for the posts that had a removed reaction.

DELETE FROM "reactions" WHERE "reaction_type_id" IN (4, 5, 6);
DELETE FROM "reaction_types" WHERE "id" IN (4, 5, 6);

INSERT INTO "reaction_types" ("id", "name", "emoji", "sort_order") VALUES
    (1, 'like',       '👍', 1),
    (2, 'love',       '❤️', 2),
    (7, 'insightful', '💡', 3),
    (3, 'haha',       '😂', 4),
    (8, 'celebrate',  '👏', 5)
ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "emoji" = EXCLUDED."emoji", "sort_order" = EXCLUDED."sort_order";

UPDATE "posts" p SET "reaction_counts" = (
    SELECT COALESCE(jsonb_object_agg(rt."name", c."n"), '{}'::jsonb)
    FROM (SELECT "reaction_type_id", count(*) AS "n" FROM "reactions" WHERE "post_id" = p."id" GROUP BY "reaction_type_id") c
    JOIN "reaction_types" rt ON rt."id" = c."reaction_type_id"
)
WHERE p."reaction_counts" ?| ARRAY['wow', 'sad', 'angry'];
