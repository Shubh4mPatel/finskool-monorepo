-- AlterTable
ALTER TABLE "performance_periods" ADD COLUMN "name" VARCHAR(60);
ALTER TABLE "performance_periods" ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT false;

-- Existing cards keep the label they showed ("Oct25 to Aug26") as their name.
UPDATE "performance_periods"
SET "name" = to_char("from_month", 'FMMon') || to_char("from_month", 'YY')
          || ' to '
          || to_char("to_month", 'FMMon') || to_char("to_month", 'YY');

ALTER TABLE "performance_periods" ALTER COLUMN "name" SET NOT NULL;

-- The oldest card of each board and segment becomes the default, so the app always has one to open on.
UPDATE "performance_periods" p
SET "is_default" = true
FROM (
  SELECT DISTINCT ON ("board_id", "segment") "id"
  FROM "performance_periods"
  ORDER BY "board_id", "segment", "created_at" ASC, "id" ASC
) first_card
WHERE p."id" = first_card."id";

-- At most one default per board and segment.
CREATE UNIQUE INDEX "uq_performance_periods_default" ON "performance_periods"("board_id", "segment") WHERE "is_default";
