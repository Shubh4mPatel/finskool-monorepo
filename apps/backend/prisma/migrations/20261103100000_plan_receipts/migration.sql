-- Payment receipts for plan purchases (PDF stored in the invoices bucket, emailed, downloadable in the app).
CREATE TABLE "plan_receipts" (
    "id" UUID NOT NULL,
    "plan_order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "financial_year" VARCHAR(9) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "razorpay_payment_id" VARCHAR(64),
    "pdf_object_key" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_receipts_plan_order_id_key" ON "plan_receipts"("plan_order_id");
CREATE UNIQUE INDEX "plan_receipts_number_key" ON "plan_receipts"("number");
CREATE UNIQUE INDEX "uq_plan_receipts_fy_sequence" ON "plan_receipts"("financial_year", "sequence");
CREATE INDEX "idx_plan_receipts_user" ON "plan_receipts"("user_id", "issued_at" DESC);

ALTER TABLE "plan_receipts" ADD CONSTRAINT "plan_receipts_plan_order_id_fkey" FOREIGN KEY ("plan_order_id") REFERENCES "plan_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_receipts" ADD CONSTRAINT "plan_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
