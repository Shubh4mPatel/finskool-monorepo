-- The free community has no expiry: valid_until becomes nullable, and the 100-year placeholder dates are cleared.
ALTER TABLE "subscriptions" ALTER COLUMN "valid_until" DROP NOT NULL;

UPDATE "subscriptions" s
SET "valid_until" = NULL
FROM "communities" c
WHERE s."community_id" = c."id" AND c."is_free" = true;
