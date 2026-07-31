/*
  Warnings:

  - Added the required column `title` to the `notifications` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "link" VARCHAR(500),
ADD COLUMN     "title" TEXT;

-- Backfill rows that predate the title column before enforcing NOT NULL below.
UPDATE "notifications" SET "title" = 'Notification' WHERE "title" IS NULL;

ALTER TABLE "notifications" ALTER COLUMN "title" SET NOT NULL;
