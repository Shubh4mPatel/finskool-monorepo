-- Cursor paging for the notifications inbox ("items older than this one") needs two things:
--  1. created_at at millisecond precision, the same precision a cursor carries (a JS Date). With the default
--     microseconds, two rows created in the same millisecond could be skipped between pages.
--  2. an index in the exact order the inbox is read: newest first, id as the tie-break.
ALTER TABLE "notifications" ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3);

DROP INDEX IF EXISTS "idx_notifications_user_feed";
CREATE INDEX "idx_notifications_user_feed" ON "notifications"("user_id", "created_at" DESC, "id" DESC);
