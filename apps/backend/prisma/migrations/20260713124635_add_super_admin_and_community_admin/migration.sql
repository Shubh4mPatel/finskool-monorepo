-- AlterTable
ALTER TABLE "comment_notifications" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_super_admin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "community_admins" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_community_admins_community" ON "community_admins"("community_id");

-- CreateIndex
CREATE INDEX "idx_community_admins_admin" ON "community_admins"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_admins_community_id_admin_id_key" ON "community_admins"("community_id", "admin_id");

-- AddForeignKey
ALTER TABLE "community_admins" ADD CONSTRAINT "community_admins_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_admins" ADD CONSTRAINT "community_admins_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
