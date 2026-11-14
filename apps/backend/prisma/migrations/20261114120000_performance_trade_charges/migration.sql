-- Intraday charges differ from trade to trade. A trade can now carry its own; NULL keeps using the board's
-- charges_per_trade, so every existing trade is priced exactly as before.
ALTER TABLE "performance_trades" ADD COLUMN "charges" DECIMAL(10,2);
