-- GST is added on top of a plan's price. The order remembers the split it charged; the receipt keeps the tax split.
ALTER TABLE "plan_orders"
  ADD COLUMN "base_amount" DECIMAL(10,2),
  ADD COLUMN "gst_amount" DECIMAL(10,2),
  ADD COLUMN "gst_rate_percent" DECIMAL(5,2);

ALTER TABLE "plan_receipts"
  ADD COLUMN "taxable_value" DECIMAL(10,2),
  ADD COLUMN "gst_rate_percent" DECIMAL(5,2),
  ADD COLUMN "cgst" DECIMAL(10,2),
  ADD COLUMN "sgst" DECIMAL(10,2),
  ADD COLUMN "igst" DECIMAL(10,2);

-- Tax invoices share the service invoices' number series, plain receipts keep theirs ("R2026-27"). The two can reach
-- the same sequence in the same year, so (financial_year, sequence) can no longer be unique; the number still is.
DROP INDEX "plan_receipts_financial_year_sequence_key";
