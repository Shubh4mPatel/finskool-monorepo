-- Keyset pagination on (last_message_at | created_at, id) round-trips the timestamp through a
-- JS Date (milliseconds). With the default microsecond precision, rows sharing a millisecond
-- could be skipped between pages, so store these two columns at millisecond precision.

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "last_message_at" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ticket_messages" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);
