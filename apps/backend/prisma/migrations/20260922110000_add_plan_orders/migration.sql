-- CreateTable
CREATE TABLE "plan_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "razorpay_order_id" VARCHAR(64) NOT NULL,
    "razorpay_payment_id" VARCHAR(64),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(20) NOT NULL DEFAULT 'created',
    "subscription_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_orders_razorpay_order_id_key" ON "plan_orders"("razorpay_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_orders_razorpay_payment_id_key" ON "plan_orders"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "idx_plan_orders_user" ON "plan_orders"("user_id");

-- CreateIndex
CREATE INDEX "idx_plan_orders_community" ON "plan_orders"("community_id");

-- AddForeignKey
ALTER TABLE "plan_orders" ADD CONSTRAINT "plan_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_orders" ADD CONSTRAINT "plan_orders_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_orders" ADD CONSTRAINT "plan_orders_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
