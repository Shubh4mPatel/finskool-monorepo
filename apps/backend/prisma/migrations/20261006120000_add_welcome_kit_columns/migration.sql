-- AlterTable
ALTER TABLE "community_kits"
    ADD COLUMN "watch_before_you_start" JSONB,
    ADD COLUMN "capital_allocation" JSONB,
    ADD COLUMN "strategy_notices" JSONB,
    ADD COLUMN "what_you_get" JSONB;
