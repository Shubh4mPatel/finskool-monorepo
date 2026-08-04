-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'registered', 'expired', 'suspended', 'deleted');

-- AlterTable
ALTER TABLE "approved_phones" ADD COLUMN "status" "MemberStatus" NOT NULL DEFAULT 'pending';
