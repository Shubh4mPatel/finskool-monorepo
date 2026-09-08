-- ── User: isActive → status (active/suspended/deleted) ──────────────────────
-- Deleted vs. suspended used to be conflated under isActive (both false) —
-- ApprovedPhone.status (still 5-valued at this point in the migration) is
-- what actually distinguished them, so the backfill below reads from there.

CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

ALTER TABLE "users" ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active';

UPDATE "users" u
SET "status" = CASE
  WHEN u."is_active" THEN 'active'::"UserStatus"
  ELSE COALESCE(
    (SELECT CASE ap."status"
       WHEN 'suspended' THEN 'suspended'::"UserStatus"
       WHEN 'deleted' THEN 'deleted'::"UserStatus"
       ELSE 'deleted'::"UserStatus"  -- conservative fallback: inactive with no clearer signal
     END
     FROM "approved_phones" ap WHERE ap."phone" = u."phone"),
    'deleted'::"UserStatus"  -- inactive with no matching ApprovedPhone at all (shouldn't happen)
  )
END;

ALTER TABLE "users" DROP COLUMN "is_active";

-- ── ApprovedPhone: trim MemberStatus to pending/registered only ─────────────
-- isActive/isRegistered are dropped; status becomes purely "has this phone
-- been claimed" (isRegistered's old meaning, backfilled from it directly
-- rather than from the old status value, since that's the more reliable
-- source). expired/suspended/deleted are accounted for by the User.status
-- backfill above and never stored on ApprovedPhone again — see
-- AdminService#deriveMemberStatus for how the admin dashboard now computes
-- the display status at read time instead.

ALTER TABLE "approved_phones" ADD COLUMN "status_new" TEXT;
UPDATE "approved_phones" SET "status_new" = CASE WHEN "is_registered" THEN 'registered' ELSE 'pending' END;

ALTER TABLE "approved_phones" DROP COLUMN "status";
ALTER TABLE "approved_phones" DROP COLUMN "is_active";
ALTER TABLE "approved_phones" DROP COLUMN "is_registered";

-- Safe to drop now — the column that referenced it is gone, and it was the
-- only column in the schema using this type.
DROP TYPE "MemberStatus";
CREATE TYPE "MemberStatus" AS ENUM ('pending', 'registered');

ALTER TABLE "approved_phones"
  ALTER COLUMN "status_new" TYPE "MemberStatus" USING "status_new"::"MemberStatus";
ALTER TABLE "approved_phones" ALTER COLUMN "status_new" SET DEFAULT 'pending';
ALTER TABLE "approved_phones" ALTER COLUMN "status_new" SET NOT NULL;
ALTER TABLE "approved_phones" RENAME COLUMN "status_new" TO "status";
