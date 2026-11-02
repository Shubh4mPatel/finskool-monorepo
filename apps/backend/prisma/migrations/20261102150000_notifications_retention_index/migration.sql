-- The daily retention job deletes read notifications older than 90 days. This partial index lets it find them
-- without scanning the whole table: only read rows are indexed, ordered by age.
CREATE INDEX "idx_notifications_read_created" ON "notifications"("created_at") WHERE "is_read" = true;
