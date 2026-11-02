-- Outbox for pushes. A notification that should also be pushed is saved with push_pending = true and flipped to
-- false once the push job is queued. If queueing fails (Redis blip) or the process dies between the two steps, the
-- row stays pending and a small recurring job queues the push later, instead of the push being lost for good.
ALTER TABLE "notifications" ADD COLUMN "push_pending" BOOLEAN NOT NULL DEFAULT false;

-- Only pending rows are indexed, and there are almost never any.
CREATE INDEX "idx_notifications_push_pending" ON "notifications"("created_at") WHERE "push_pending" = true;
