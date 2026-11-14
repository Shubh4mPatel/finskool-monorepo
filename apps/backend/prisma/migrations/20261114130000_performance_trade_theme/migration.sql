-- Long Term and US Investment sheets carry a "Theme / Sector / Type" column per company. NULL for every existing trade.
ALTER TABLE "performance_trades" ADD COLUMN "theme" VARCHAR(100);
