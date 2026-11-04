-- The plan invoice names who runs the business and how to verify it.
ALTER TABLE "billing_settings"
  ADD COLUMN "proprietor_name" VARCHAR(150),
  ADD COLUMN "pan" VARCHAR(10),
  ADD COLUMN "sebi_registration_no" VARCHAR(30),
  ADD COLUMN "website" VARCHAR(200);

-- What each plan receipt covers and how it was paid. Receipts issued before this have neither.
ALTER TABLE "plan_receipts"
  ADD COLUMN "period_start" DATE,
  ADD COLUMN "period_end" DATE,
  ADD COLUMN "payment" JSONB;
