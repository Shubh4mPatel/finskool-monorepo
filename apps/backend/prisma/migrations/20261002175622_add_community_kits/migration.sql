-- AlterTable
ALTER TABLE "mobile_sessions" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "community_kits" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "trading_setup_info" JSONB,
    "welcome_kit" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_kits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_kits_community_id_key" ON "community_kits"("community_id");

-- AddForeignKey
ALTER TABLE "community_kits" ADD CONSTRAINT "community_kits_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
