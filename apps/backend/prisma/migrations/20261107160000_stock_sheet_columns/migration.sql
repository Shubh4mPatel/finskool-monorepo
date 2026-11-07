-- CreateEnum
CREATE TYPE "StockListing" AS ENUM ('nse_bse', 'nse', 'bse');

-- AlterTable
ALTER TABLE "stocks" ADD COLUMN     "isin" VARCHAR(12),
ADD COLUMN     "bse_code" VARCHAR(10),
ADD COLUMN     "bse_symbol" VARCHAR(50),
ADD COLUMN     "listed_on" "StockListing",
ADD COLUMN     "nse_board" VARCHAR(30),
ADD COLUMN     "nse_series" VARCHAR(10),
ADD COLUMN     "industry" VARCHAR(100),
ADD COLUMN     "website" VARCHAR(255),
ADD COLUMN     "nse_listing_date" DATE,
ADD COLUMN     "face_value" DECIMAL(10,2);

-- CreateIndex
CREATE UNIQUE INDEX "stocks_isin_key" ON "stocks"("isin");
