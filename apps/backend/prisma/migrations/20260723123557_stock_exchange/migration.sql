-- CreateEnum
CREATE TYPE "StockExchange" AS ENUM ('nse', 'bse');

-- AlterTable
ALTER TABLE "stocks" ADD COLUMN     "exchange" "StockExchange";
