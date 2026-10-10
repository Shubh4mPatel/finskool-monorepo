-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('payments', 'subscription', 'account', 'content', 'app_bug', 'other');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('issue', 'question', 'feature_request', 'refund_request');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "TicketSenderRole" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "TicketEventType" AS ENUM ('created', 'assigned', 'reassigned', 'resolved');

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "category" "TicketCategory" NOT NULL,
    "type" "TicketType" NOT NULL,
    "subject" VARCHAR(150) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "assigned_admin_id" UUID,
    "client_request_id" VARCHAR(64) NOT NULL,
    "user_unread_count" INTEGER NOT NULL DEFAULT 0,
    "admin_unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" SMALLINT,
    "rating_comment" VARCHAR(1000),
    "rated_at" TIMESTAMPTZ,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_role" "TicketSenderRole" NOT NULL,
    "body" VARCHAR(2000),
    "client_message_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "message_id" UUID,
    "object_key" VARCHAR(300) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "type" "TicketEventType" NOT NULL,
    "actor_id" UUID NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_number_key" ON "tickets"("number");

-- CreateIndex
CREATE INDEX "idx_tickets_community_status" ON "tickets"("community_id", "status");

-- CreateIndex
CREATE INDEX "idx_tickets_assignee_status" ON "tickets"("assigned_admin_id", "status");

-- CreateIndex
CREATE INDEX "idx_tickets_user_recent" ON "tickets"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_user_id_client_request_id_key" ON "tickets"("user_id", "client_request_id");

-- CreateIndex
CREATE INDEX "idx_ticket_messages_thread" ON "ticket_messages"("ticket_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_messages_ticket_id_client_message_id_key" ON "ticket_messages"("ticket_id", "client_message_id");

-- CreateIndex
CREATE INDEX "idx_ticket_attachments_ticket" ON "ticket_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "idx_ticket_attachments_message" ON "ticket_attachments"("message_id");

-- CreateIndex
CREATE INDEX "idx_ticket_events_ticket" ON "ticket_events"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

