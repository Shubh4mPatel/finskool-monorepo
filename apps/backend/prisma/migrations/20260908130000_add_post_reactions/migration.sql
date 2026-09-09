-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "reaction_counts" JSONB;

-- CreateTable
CREATE TABLE "reaction_types" (
    "id" SMALLINT NOT NULL,
    "name" VARCHAR(20) NOT NULL,
    "emoji" VARCHAR(8) NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "reaction_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reaction_type_id" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reaction_types_name_key" ON "reaction_types"("name");

-- CreateIndex
CREATE INDEX "idx_reactions_post" ON "reactions"("post_id");

-- CreateIndex
CREATE INDEX "idx_reactions_user" ON "reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_post_id_user_id_key" ON "reactions"("post_id", "user_id");

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_reaction_type_id_fkey" FOREIGN KEY ("reaction_type_id") REFERENCES "reaction_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the fixed reaction types. This runs on every environment exactly once
-- (via `prisma migrate deploy`, which applies each migration file once) —
-- unlike prisma/seed.ts, which only runs on first container boot
-- (see docker-entrypoint.sh's /data/seed/.seeded flag) and would never reach
-- an already-deployed environment. ON CONFLICT keeps this safe to re-run.
INSERT INTO "reaction_types" ("id", "name", "emoji", "sort_order") VALUES
    (1, 'like',  '👍', 1),
    (2, 'love',  '❤️', 2),
    (3, 'haha',  '😂', 3),
    (4, 'wow',   '😮', 4),
    (5, 'sad',   '😢', 5),
    (6, 'angry', '😡', 6)
ON CONFLICT ("id") DO NOTHING;
