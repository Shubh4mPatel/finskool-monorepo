-- AlterTable
ALTER TABLE "users" ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "kyc_submitted_at" TIMESTAMPTZ,
ADD COLUMN     "pan_encrypted" VARCHAR(255);
