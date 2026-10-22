-- Service catalog details: icon, type, tags, highlights chips, and what members get.
ALTER TABLE "services"
  ADD COLUMN "icon_url" VARCHAR(500),
  ADD COLUMN "service_type" VARCHAR(40),
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "what_members_get" JSONB NOT NULL DEFAULT '[]';
