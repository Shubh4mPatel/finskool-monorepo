-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "source_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_notifications_user_feed" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_notifications_user_unread" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "idx_notifications_community" ON "notifications"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_type_source_id_key" ON "notifications"("user_id", "type", "source_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
