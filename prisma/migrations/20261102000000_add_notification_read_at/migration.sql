-- AlterTable: the notification list ("通知") shows what is unread
ALTER TABLE "notification_events" ADD COLUMN "read_at" TIMESTAMP(3);

-- Everything that exists before this change counts as read (it was never shown anywhere)
UPDATE "notification_events" SET "read_at" = "created_at";

-- CreateIndex
CREATE INDEX "notification_events_user_id_created_at_idx" ON "notification_events"("user_id", "created_at");
