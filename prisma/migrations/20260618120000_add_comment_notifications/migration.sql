-- CreateTable
CREATE TABLE "comment_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "comment_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "is_replied" BOOLEAN NOT NULL DEFAULT false,
    "replied_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "comment_notifications_comment_id_key" ON "comment_notifications"("comment_id");

-- CreateIndex
CREATE INDEX "idx_comment_notifications_pending" ON "comment_notifications"("is_replied", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_comment_notifications_post" ON "comment_notifications"("post_id");

-- AddForeignKey
ALTER TABLE "comment_notifications" ADD CONSTRAINT "comment_notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_notifications" ADD CONSTRAINT "comment_notifications_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
