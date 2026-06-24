-- Add user_id as nullable first so existing rows don't break
ALTER TABLE "subscriptions" ADD COLUMN "user_id" UUID;

-- Backfill: match existing subscriptions to users via approved_phones.phone = users.phone
UPDATE "subscriptions" s
SET "user_id" = u."id"
FROM "approved_phones" ap
JOIN "users" u ON u."phone" = ap."phone"
WHERE s."approved_phone_id" = ap."id";

-- Delete any rows that couldn't be backfilled (no matching user yet)
DELETE FROM "subscriptions" WHERE "user_id" IS NULL;

-- Now make the column required
ALTER TABLE "subscriptions" ALTER COLUMN "user_id" SET NOT NULL;

-- Add FK constraint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Make passwordHash nullable (users pre-created by admin have no password yet)
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Drop old unique constraint and add new one on (user_id, community_id)
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "uq_subscription_phone_community";
ALTER TABLE "subscriptions" ADD CONSTRAINT "uq_subscription_user_community"
  UNIQUE ("user_id", "community_id");

-- Indexes
CREATE INDEX "idx_subscriptions_user" ON "subscriptions"("user_id");
