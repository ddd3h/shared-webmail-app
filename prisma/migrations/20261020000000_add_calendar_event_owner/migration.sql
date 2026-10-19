-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN "owner_user_id" TEXT;

-- Imported Google events belong to whoever linked the calendar
UPDATE "calendar_events" e SET "owner_user_id" = l."linked_by_user_id"
FROM "calendar_google_links" l WHERE e."link_id" = l."id";

-- CreateIndex
CREATE INDEX "calendar_events_owner_user_id_idx" ON "calendar_events"("owner_user_id");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
