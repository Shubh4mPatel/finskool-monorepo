-- Push notifications (FCM): device token on the single mobile session, master mute on the user,
-- and notification rows that may belong to no community (service requests) and carry routing data.
ALTER TABLE "mobile_sessions"
  ADD COLUMN "fcm_token" VARCHAR(512),
  ADD COLUMN "fcm_token_updated_at" TIMESTAMPTZ,
  ADD COLUMN "app_version" VARCHAR(32);

CREATE INDEX "idx_mobile_sessions_fcm_token" ON "mobile_sessions"("fcm_token");

ALTER TABLE "users" ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "notifications" ALTER COLUMN "community_id" DROP NOT NULL;
ALTER TABLE "notifications" ADD COLUMN "data" JSONB;
