-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE 'canceled';

-- CreateTable
CREATE TABLE "scheduled_sends" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "thread_id" TEXT,
    "reply_to_message_id" TEXT,
    "to_raw" TEXT NOT NULL,
    "cc_raw" TEXT,
    "bcc_raw" TEXT,
    "subject" TEXT NOT NULL,
    "html_body" TEXT,
    "text_body" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "sent_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_send_attachments" (
    "id" TEXT NOT NULL,
    "scheduled_send_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_send_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scheduled_sends_status_scheduled_at_idx" ON "scheduled_sends"("status", "scheduled_at");

-- AddForeignKey
ALTER TABLE "scheduled_sends" ADD CONSTRAINT "scheduled_sends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_sends" ADD CONSTRAINT "scheduled_sends_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_sends" ADD CONSTRAINT "scheduled_sends_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_send_attachments" ADD CONSTRAINT "scheduled_send_attachments_scheduled_send_id_fkey" FOREIGN KEY ("scheduled_send_id") REFERENCES "scheduled_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;
