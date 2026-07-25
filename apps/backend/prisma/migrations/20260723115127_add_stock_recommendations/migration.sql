-- CreateEnum
CREATE TYPE "StockActionCall" AS ENUM ('buy', 'hold', 'exit');

-- CreateEnum
CREATE TYPE "StockRiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "stocks" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "symbol" VARCHAR(50) NOT NULL,
    "sector" VARCHAR(100) NOT NULL,
    "token" VARCHAR(50),
    "cmp" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_recommendations" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "recommended_by" UUID NOT NULL,
    "stock_id" UUID NOT NULL,
    "entry_price" DECIMAL(10,2) NOT NULL,
    "target_price" DECIMAL(10,2) NOT NULL,
    "stop_loss_price" DECIMAL(10,2) NOT NULL,
    "action_call" "StockActionCall" NOT NULL,
    "risk_level" "StockRiskLevel" NOT NULL,
    "recommendation_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "stock_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stocks_symbol_key" ON "stocks"("symbol");

-- CreateIndex
CREATE INDEX "idx_stocks_symbol" ON "stocks"("symbol");

-- CreateIndex
CREATE INDEX "idx_stocks_active" ON "stocks"("is_active");

-- CreateIndex
CREATE INDEX "idx_stock_recommendations_community_feed" ON "stock_recommendations"("community_id", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_stock_recommendations_recommended_by" ON "stock_recommendations"("recommended_by");

-- CreateIndex
CREATE INDEX "idx_stock_recommendations_stock" ON "stock_recommendations"("stock_id");

-- AddForeignKey
ALTER TABLE "stock_recommendations" ADD CONSTRAINT "stock_recommendations_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_recommendations" ADD CONSTRAINT "stock_recommendations_recommended_by_fkey" FOREIGN KEY ("recommended_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_recommendations" ADD CONSTRAINT "stock_recommendations_stock_id_fkey" FOREIGN KEY ("stock_id") REFERENCES "stocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
