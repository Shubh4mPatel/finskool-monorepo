-- CreateTable
CREATE TABLE "community_blocks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "blocked_by" UUID,
    "suspended_subscription_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_community_blocks_community" ON "community_blocks"("community_id");

-- CreateIndex
CREATE INDEX "idx_community_blocks_user" ON "community_blocks"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_community_block" ON "community_blocks"("user_id", "community_id");

-- AddForeignKey
ALTER TABLE "community_blocks" ADD CONSTRAINT "community_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_blocks" ADD CONSTRAINT "community_blocks_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_blocks" ADD CONSTRAINT "community_blocks_blocked_by_fkey" FOREIGN KEY ("blocked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
