-- Subscription no longer requires an ApprovedPhone — a self-registered user
-- (no ApprovedPhone row at all) must be able to hold a subscription, or they
-- can never pass login()'s hasActiveSubscription gate on either platform.
-- See Subscription's own doc comment in schema.prisma for the full reasoning.

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_approved_phone_id_fkey";

-- DropIndex
DROP INDEX "idx_subscriptions_approved_phone";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "approved_phone_id";

-- AlterTable
-- The community every brand-new self-registered user is auto-subscribed to
-- at signup — see prisma/seed.ts / prisma/backfill-free-community.ts for how
-- the one row with this set is created (deliberately not done here — this
-- migration is pure schema, no data; see those scripts' own comments).
ALTER TABLE "communities" ADD COLUMN "is_free" BOOLEAN NOT NULL DEFAULT false;
