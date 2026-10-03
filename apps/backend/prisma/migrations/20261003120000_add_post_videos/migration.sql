-- CreateEnum
CREATE TYPE "VideoKind" AS ENUM ('file', 'youtube', 'instagram');

-- CreateTable
CREATE TABLE "post_videos" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "kind" "VideoKind" NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "external_id" VARCHAR(64),
    "title" VARCHAR(300),
    "thumbnail_url" VARCHAR(1000),
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_post_videos_post" ON "post_videos"("post_id", "position");

-- AddForeignKey
ALTER TABLE "post_videos" ADD CONSTRAINT "post_videos_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
