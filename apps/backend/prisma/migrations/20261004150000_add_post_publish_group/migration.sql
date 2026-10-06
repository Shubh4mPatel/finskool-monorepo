-- AlterTable
ALTER TABLE "posts" ADD COLUMN "publish_group_id" UUID;

-- CreateIndex
CREATE INDEX "idx_posts_publish_group" ON "posts"("publish_group_id");

-- Backfill: link copies that were created together before this column existed. A publish to
-- several targets creates its posts milliseconds apart with the same author, title and content,
-- so identical posts by one author created within 3 seconds of each other form a group. Posts
-- that have no such twin keep NULL.
WITH ordered AS (
    SELECT id, author_id, title, content_md, created_at,
           CASE WHEN created_at - LAG(created_at) OVER w <= INTERVAL '3 seconds' THEN 0 ELSE 1 END AS starts_group
    FROM "posts"
    WHERE deleted_at IS NULL
    WINDOW w AS (PARTITION BY author_id, title, content_md ORDER BY created_at)
), numbered AS (
    SELECT id, author_id, title, content_md,
           SUM(starts_group) OVER (PARTITION BY author_id, title, content_md ORDER BY created_at) AS grp
    FROM ordered
), groups AS (
    SELECT author_id, title, content_md, grp, gen_random_uuid() AS gid
    FROM numbered
    GROUP BY author_id, title, content_md, grp
    HAVING COUNT(*) > 1
)
UPDATE "posts" p
SET publish_group_id = g.gid
FROM numbered n
JOIN groups g
  ON g.author_id = n.author_id AND g.title = n.title AND g.content_md = n.content_md AND g.grp = n.grp
WHERE p.id = n.id;
