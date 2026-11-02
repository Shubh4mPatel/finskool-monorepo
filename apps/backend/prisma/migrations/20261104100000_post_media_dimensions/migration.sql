-- Real size of post media, so the app can lay posts out by ratio.
CREATE TYPE "MediaOrientation" AS ENUM ('portrait', 'landscape');

ALTER TABLE "posts"
    ADD COLUMN "media_width" INTEGER,
    ADD COLUMN "media_height" INTEGER,
    ADD COLUMN "media_ratio" DOUBLE PRECISION,
    ADD COLUMN "media_orientation" "MediaOrientation";

ALTER TABLE "post_videos"
    ADD COLUMN "width" INTEGER,
    ADD COLUMN "height" INTEGER,
    ADD COLUMN "duration_sec" INTEGER;

CREATE TABLE "post_images" (
    "id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_post_images_post" ON "post_images"("post_id", "position");

ALTER TABLE "post_images" ADD CONSTRAINT "post_images_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
