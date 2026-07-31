/*
  Warnings:

  - Added the required column `title` to the `notifications` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "link" VARCHAR(500),
ADD COLUMN     "title" TEXT NOT NULL;
