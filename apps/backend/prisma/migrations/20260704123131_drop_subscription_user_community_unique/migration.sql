-- DropIndex (superseded by the user_id/community_id constraint; no longer in schema)
DROP INDEX IF EXISTS "subscriptions_approved_phone_id_community_id_key";

-- Allow multiple subscription rows per (user, community) so renewals can be
-- kept as history instead of overwriting the previous period in place.
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "uq_subscription_user_community";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_subscriptions_user_community" ON "subscriptions"("user_id", "community_id");
