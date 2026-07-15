-- Scope the (community_id, pin_order) uniqueness to non-deleted posts.
-- The previous unconditional unique index didn't know about deleted_at, so a
-- soft-deleted post left pinned would permanently occupy its pin slot and
-- block any other post in the community from ever being pinned again.
DROP INDEX "posts_community_id_pin_order_key";

CREATE UNIQUE INDEX "posts_community_id_pin_order_key" ON "posts"("community_id", "pin_order") WHERE "deleted_at" IS NULL;
