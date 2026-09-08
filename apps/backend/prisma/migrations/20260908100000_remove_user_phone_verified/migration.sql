-- isPhoneVerified is now redundant: since the mobile-auth register/verify-otp
-- rework, `passwordHash` is only ever written to a User row at the same
-- moment verification succeeds (see mobile-auth.service.ts#finalizeRegistration),
-- so `passwordHash IS NOT NULL` already implies "phone verified" for every
-- row in the table. Nothing sets this column to false anymore.
ALTER TABLE "users" DROP COLUMN "is_phone_verified";
