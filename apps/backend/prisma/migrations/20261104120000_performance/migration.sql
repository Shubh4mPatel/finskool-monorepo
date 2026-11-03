-- CreateEnum
CREATE TYPE "PerformanceKind" AS ENUM ('intraday', 'swing', 'investor');

-- CreateEnum
CREATE TYPE "PerformanceSegment" AS ENUM ('main', 'investor', 'long_term', 'us_investment');

-- CreateEnum
CREATE TYPE "TradeVisibility" AS ENUM ('auto', 'show', 'hide');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('buy', 'sell');

-- CreateTable
CREATE TABLE "performance_boards" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "kind" "PerformanceKind" NOT NULL,
    "hide_newer_than_days" INTEGER NOT NULL DEFAULT 7,
    "max_free_trades" INTEGER NOT NULL DEFAULT 3,
    "capital" DECIMAL(14,2) NOT NULL DEFAULT 50000,
    "margin" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "charges_per_trade" DECIMAL(10,2) NOT NULL DEFAULT 140,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_trades" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "segment" "PerformanceSegment" NOT NULL DEFAULT 'main',
    "trade_date" DATE NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "symbol" VARCHAR(40),
    "side" "TradeSide",
    "entry_price" DECIMAL(12,2) NOT NULL,
    "exit_price" DECIMAL(12,2),
    "cmp" DECIMAL(12,2),
    "target_pct" DECIMAL(5,2),
    "analysis" VARCHAR(60),
    "exit_date" DATE,
    "visibility" "TradeVisibility" NOT NULL DEFAULT 'auto',
    "trade_key" VARCHAR(220) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_periods" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "segment" "PerformanceSegment" NOT NULL DEFAULT 'main',
    "from_month" DATE NOT NULL,
    "to_month" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_periods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_boards_community_id_key" ON "performance_boards"("community_id");

-- CreateIndex
CREATE INDEX "idx_performance_trades_board_date" ON "performance_trades"("board_id", "segment", "trade_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "performance_trades_board_id_segment_trade_key_key" ON "performance_trades"("board_id", "segment", "trade_key");

-- CreateIndex
CREATE INDEX "idx_performance_periods_board" ON "performance_periods"("board_id", "segment");

-- AddForeignKey
ALTER TABLE "performance_boards" ADD CONSTRAINT "performance_boards_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_trades" ADD CONSTRAINT "performance_trades_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "performance_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_periods" ADD CONSTRAINT "performance_periods_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "performance_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_auth_identities_provider_sub" RENAME TO "auth_identities_provider_provider_user_id_key";

-- RenameIndex
ALTER INDEX "uq_plan_receipts_fy_sequence" RENAME TO "plan_receipts_financial_year_sequence_key";
