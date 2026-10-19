-- CreateTable
CREATE TABLE "calendar_google_links" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "linked_by_user_id" TEXT NOT NULL,
    "encrypted_token" TEXT NOT NULL,
    "google_calendar_id" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Googleカレンダー',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "display_mode" TEXT NOT NULL DEFAULT 'busy_only',
    "busy_label" TEXT NOT NULL DEFAULT '予定あり',
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_google_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "link_id" TEXT,
    "google_event_id" TEXT,
    "title" TEXT,
    "title_override" TEXT,
    "description" TEXT,
    "location" TEXT,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_google_links_mailbox_id_idx" ON "calendar_google_links"("mailbox_id");
CREATE INDEX "calendar_events_mailbox_id_start_at_idx" ON "calendar_events"("mailbox_id", "start_at");
CREATE UNIQUE INDEX "calendar_events_link_id_google_event_id_key" ON "calendar_events"("link_id", "google_event_id");

-- AddForeignKey
ALTER TABLE "calendar_google_links" ADD CONSTRAINT "calendar_google_links_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_google_links" ADD CONSTRAINT "calendar_google_links_linked_by_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "calendar_google_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
