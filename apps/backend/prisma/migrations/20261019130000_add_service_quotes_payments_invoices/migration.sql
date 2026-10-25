-- CreateEnum
CREATE TYPE "ServiceQuoteStatus" AS ENUM ('active', 'superseded', 'expired', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "RazorpayOrderPurpose" AS ENUM ('service_quote');

-- CreateEnum
CREATE TYPE "RazorpayOrderStatus" AS ENUM ('created', 'paid');

-- CreateEnum
CREATE TYPE "RazorpayPaymentStatus" AS ENUM ('authorized', 'captured', 'failed');

-- CreateEnum
CREATE TYPE "RazorpaySettleSource" AS ENUM ('verify', 'webhook');

-- AlterEnum
ALTER TYPE "ServiceEventType" ADD VALUE 'review_resolved';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "requires_review" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_messages" ADD COLUMN     "quote_id" UUID;

-- CreateTable
CREATE TABLE "service_quotes" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "gst_rate_percent" DECIMAL(5,2) NOT NULL,
    "gst_amount" DECIMAL(12,2) NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "note" VARCHAR(1000),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "status" "ServiceQuoteStatus" NOT NULL DEFAULT 'active',
    "billing" JSONB,
    "payment_started_at" TIMESTAMPTZ,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_orders" (
    "id" UUID NOT NULL,
    "razorpay_order_id" VARCHAR(64) NOT NULL,
    "purpose" "RazorpayOrderPurpose" NOT NULL,
    "reference_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" "RazorpayOrderStatus" NOT NULL DEFAULT 'created',
    "receipt" VARCHAR(64),
    "notes" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ,

    CONSTRAINT "razorpay_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_payments" (
    "id" UUID NOT NULL,
    "razorpay_payment_id" VARCHAR(64) NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" "RazorpayPaymentStatus" NOT NULL,
    "method" VARCHAR(30),
    "settled_via" "RazorpaySettleSource",
    "error_code" VARCHAR(100),
    "error_description" VARCHAR(500),
    "raw" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "razorpay_webhook_events" (
    "id" UUID NOT NULL,
    "razorpay_event_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "processing_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "legal_name" VARCHAR(200),
    "address_line" VARCHAR(300),
    "city" VARCHAR(100),
    "pincode" VARCHAR(10),
    "state_code" VARCHAR(2),
    "gstin" VARCHAR(15),
    "sac_code" VARCHAR(10),
    "contact_email" VARCHAR(255),
    "contact_phone" VARCHAR(30),
    "footer_note" VARCHAR(500),
    "default_gst_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "default_quote_expiry_days" INTEGER NOT NULL DEFAULT 5,
    "invoice_prefix" VARCHAR(10) NOT NULL DEFAULT 'FS',
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "financial_year" VARCHAR(9) NOT NULL,
    "last_number" INTEGER NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("financial_year")
);

-- CreateTable
CREATE TABLE "service_invoices" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "financial_year" VARCHAR(9) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "sac_code" VARCHAR(10) NOT NULL,
    "taxable_value" DECIMAL(12,2) NOT NULL,
    "gst_rate_percent" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "pdf_object_key" VARCHAR(300),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_service_quotes_request_status" ON "service_quotes"("request_id", "status");

-- CreateIndex
CREATE INDEX "idx_service_quotes_expiry" ON "service_quotes"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_quotes_request_id_version_key" ON "service_quotes"("request_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_orders_razorpay_order_id_key" ON "razorpay_orders"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "idx_razorpay_orders_reference" ON "razorpay_orders"("purpose", "reference_id");

-- CreateIndex
CREATE INDEX "idx_razorpay_orders_user" ON "razorpay_orders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_payments_razorpay_payment_id_key" ON "razorpay_payments"("razorpay_payment_id");

-- CreateIndex
CREATE INDEX "idx_razorpay_payments_order" ON "razorpay_payments"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_webhook_events_razorpay_event_id_key" ON "razorpay_webhook_events"("razorpay_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoices_request_id_key" ON "service_invoices"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoices_quote_id_key" ON "service_invoices"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoices_payment_id_key" ON "service_invoices"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoices_number_key" ON "service_invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoices_financial_year_sequence_key" ON "service_invoices"("financial_year", "sequence");

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "service_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "razorpay_orders" ADD CONSTRAINT "razorpay_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "razorpay_payments" ADD CONSTRAINT "razorpay_payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "razorpay_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoices" ADD CONSTRAINT "service_invoices_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "razorpay_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One payable quote per request at a time (Prisma cannot express partial unique indexes).
CREATE UNIQUE INDEX "uq_service_quotes_one_active" ON "service_quotes"("request_id") WHERE "status" = 'active';

-- One unpaid Razorpay order per quote at a time: two concurrent "pay" taps share one order.
CREATE UNIQUE INDEX "uq_razorpay_orders_one_unpaid" ON "razorpay_orders"("purpose", "reference_id") WHERE "status" = 'created';
