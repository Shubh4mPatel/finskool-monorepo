-- Revert 20260715150000_partial_unique_pin_order: restore the unconditional
-- unique index on (community_id, pin_order), dropping the deleted_at scoping.
DROP INDEX "posts_community_id_pin_order_key";

CREATE UNIQUE INDEX "posts_community_id_pin_order_key" ON "posts"("community_id", "pin_order");
