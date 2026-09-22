-- AlterTable
ALTER TABLE "communities"
    ADD COLUMN     "subtitle" VARCHAR(200),
    ADD COLUMN     "whats_included" TEXT[],
    ADD COLUMN     "active_sub_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "duration_months" SMALLINT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "subscriptions"
    ADD COLUMN     "plan_id" UUID,
    ADD COLUMN     "source" VARCHAR(30);

-- CreateIndex
CREATE INDEX "idx_plans_community" ON "plans"("community_id");

-- CreateIndex
CREATE INDEX "idx_subscriptions_plan" ON "subscriptions"("plan_id");

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: seed active_sub_count from today's actual data so the column
-- starts correct even before the recompute-on-write logic exists.
UPDATE "communities" c
SET "active_sub_count" = (
    SELECT COUNT(*) FROM "subscriptions" s
    WHERE s."community_id" = c."id" AND s."is_active" = true AND s."valid_until" >= CURRENT_DATE
);
