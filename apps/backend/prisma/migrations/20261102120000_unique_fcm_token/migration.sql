-- One phone token belongs to at most one session. Before this, two members registering the same token at the
-- same moment could both end up holding it, so one member's pushes reached the other's phone.
--
-- First clear any duplicates already in the table (the most recently refreshed holder keeps the token), then
-- replace the plain index with a unique one. NULLs (no token) are not constrained.
UPDATE "mobile_sessions" m
SET "fcm_token" = NULL, "fcm_token_updated_at" = NULL
WHERE m."fcm_token" IS NOT NULL
  AND m."id" <> (
    SELECT m2."id"
    FROM "mobile_sessions" m2
    WHERE m2."fcm_token" = m."fcm_token"
    ORDER BY m2."fcm_token_updated_at" DESC NULLS LAST, m2."id"
    LIMIT 1
  );

DROP INDEX IF EXISTS "idx_mobile_sessions_fcm_token";
CREATE UNIQUE INDEX "mobile_sessions_fcm_token_key" ON "mobile_sessions"("fcm_token");
