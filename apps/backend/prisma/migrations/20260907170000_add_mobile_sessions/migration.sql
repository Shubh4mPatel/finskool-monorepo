-- CreateEnum
CREATE TYPE "MobileDeviceType" AS ENUM ('ios', 'android');

-- CreateTable
CREATE TABLE "mobile_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_id_hash" VARCHAR(64) NOT NULL,
    "device_id" VARCHAR(255),
    "device_type" "MobileDeviceType",
    "device_name" VARCHAR(255),
    "ip" VARCHAR(45),
    "community_ids" TEXT[],
    "selected_community_id" UUID,
    "accessible_community_ids" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mobile_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mobile_sessions_user_id_key" ON "mobile_sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_sessions_session_id_hash_key" ON "mobile_sessions"("session_id_hash");

-- AddForeignKey
ALTER TABLE "mobile_sessions" ADD CONSTRAINT "mobile_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
