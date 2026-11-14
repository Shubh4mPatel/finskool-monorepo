-- A plan order that reached Razorpay but could not be applied says why (status 'flagged').
ALTER TABLE "plan_orders" ADD COLUMN "flag_reason" VARCHAR(40);

-- Each failed payment attempt on a plan order, so the admin Transactions screen can list them.
CREATE TABLE "plan_payment_failures" (
  "id" UUID NOT NULL,
  "plan_order_id" UUID NOT NULL,
  "razorpay_payment_id" VARCHAR(64) NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "method" VARCHAR(30),
  "error_code" VARCHAR(100),
  "error_description" VARCHAR(500),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_payment_failures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_payment_failures_plan_order_id_fkey" FOREIGN KEY ("plan_order_id") REFERENCES "plan_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "plan_payment_failures_razorpay_payment_id_key" ON "plan_payment_failures"("razorpay_payment_id");
CREATE INDEX "idx_plan_payment_failures_order" ON "plan_payment_failures"("plan_order_id");
CREATE INDEX "idx_plan_payment_failures_created" ON "plan_payment_failures"("created_at" DESC);

-- The Transactions list pages by time, newest first, over paid / flagged orders and captured / failed payments.
CREATE INDEX "idx_plan_orders_status_updated" ON "plan_orders"("status", "updated_at" DESC);
CREATE INDEX "idx_razorpay_payments_status_created" ON "razorpay_payments"("status", "created_at" DESC);
