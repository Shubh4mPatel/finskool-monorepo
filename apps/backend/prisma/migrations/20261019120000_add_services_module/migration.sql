-- CreateEnum
CREATE TYPE "ServiceRequestStatus" AS ENUM ('requested', 'quote_sent', 'paid', 'closed');

-- CreateEnum
CREATE TYPE "ServiceClosedReason" AS ENUM ('completed', 'declined', 'cancelled_by_member');

-- CreateEnum
CREATE TYPE "ServiceSenderRole" AS ENUM ('user', 'admin', 'system');

-- CreateEnum
CREATE TYPE "ServiceMessageKind" AS ENUM ('text', 'quote', 'system');

-- CreateEnum
CREATE TYPE "ServiceEventType" AS ENUM ('created', 'assigned', 'reassigned', 'quote_sent', 'quote_superseded', 'quote_expired', 'paid', 'closed', 'cancelled', 'payment_flagged');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "image_url" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'requested',
    "closed_reason" "ServiceClosedReason",
    "needs" VARCHAR(2000) NOT NULL,
    "assigned_admin_id" UUID,
    "client_request_id" VARCHAR(64) NOT NULL,
    "user_unread_count" INTEGER NOT NULL DEFAULT 0,
    "admin_unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "rating" SMALLINT,
    "rating_comment" VARCHAR(1000),
    "rated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_messages" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "sender_id" UUID,
    "sender_role" "ServiceSenderRole" NOT NULL,
    "kind" "ServiceMessageKind" NOT NULL DEFAULT 'text',
    "body" VARCHAR(2000),
    "client_message_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_attachments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "message_id" UUID,
    "object_key" VARCHAR(300) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_events" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "type" "ServiceEventType" NOT NULL,
    "actor_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_services_active" ON "services"("is_active", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_number_key" ON "service_requests"("number");

-- CreateIndex
CREATE INDEX "idx_service_requests_status" ON "service_requests"("status");

-- CreateIndex
CREATE INDEX "idx_service_requests_assignee_status" ON "service_requests"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "idx_service_requests_user_recent" ON "service_requests"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "idx_service_requests_service" ON "service_requests"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_user_id_client_request_id_key" ON "service_requests"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "idx_service_messages_thread" ON "service_messages"("request_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "service_messages_request_id_client_message_id_key" ON "service_messages"("request_id", "client_message_id");

-- CreateIndex
CREATE INDEX "idx_service_attachments_request" ON "service_attachments"("request_id");

-- CreateIndex
CREATE INDEX "idx_service_attachments_message" ON "service_attachments"("message_id");

-- CreateIndex
CREATE INDEX "idx_service_attachments_object" ON "service_attachments"("object_key");

-- CreateIndex
CREATE INDEX "idx_service_events_request" ON "service_events"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_attachments" ADD CONSTRAINT "service_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_attachments" ADD CONSTRAINT "service_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "service_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A member may have only one open request per service at a time (Prisma cannot express a
-- partial unique index, so it is added by hand). The service maps its violation to
-- SERVICE_REQUEST_ALREADY_OPEN.
CREATE UNIQUE INDEX "uq_service_requests_one_open" ON "service_requests"("user_id", "service_id") WHERE "status" <> 'closed';
