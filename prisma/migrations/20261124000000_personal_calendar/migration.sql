-- Calendar and to-dos belong to a person (not to a shared mailbox). A shared mailbox only lets its members look at each other's calendars.
-- Events get attendees (other people of the company); an event shows in the calendar of its owner and of each attendee.

CREATE TABLE IF NOT EXISTS "calendar_event_attendees" (
  "event_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "calendar_event_attendees_pkey" PRIMARY KEY ("event_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "calendar_event_attendees_user_id_idx" ON "calendar_event_attendees"("user_id");
DO $$ BEGIN
  ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "calendar_event_attendees" ADD CONSTRAINT "calendar_event_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- events ----
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'mailbox_id') THEN
    -- events of the whole team (nobody's own): the person who made it owns it, and every member of the mailbox attends
    CREATE TEMP TABLE "_team_events" ON COMMIT DROP AS SELECT "id", "mailbox_id" FROM "calendar_events" WHERE "owner_user_id" IS NULL;
    UPDATE "calendar_events" e SET "owner_user_id" = COALESCE(
      e."created_by_id",
      (SELECT m."owner_user_id" FROM "mailboxes" m WHERE m."id" = e."mailbox_id"),
      (SELECT u."id" FROM "users" u WHERE u."role" = 'admin' ORDER BY u."created_at" LIMIT 1),
      (SELECT p."user_id" FROM "mailbox_permissions" p WHERE p."mailbox_id" = e."mailbox_id" AND p."can_view" ORDER BY p."user_id" LIMIT 1)
    ) WHERE e."owner_user_id" IS NULL;
    INSERT INTO "calendar_event_attendees" ("event_id", "user_id")
      SELECT t."id", p."user_id" FROM "_team_events" t
        JOIN "calendar_events" e ON e."id" = t."id"
        JOIN "mailbox_permissions" p ON p."mailbox_id" = t."mailbox_id" AND p."can_view"
        WHERE p."user_id" <> e."owner_user_id"
      ON CONFLICT DO NOTHING;
    DELETE FROM "calendar_events" WHERE "owner_user_id" IS NULL; -- nobody to own it (no users at all)
    DROP INDEX IF EXISTS "calendar_events_mailbox_id_start_at_idx";
    ALTER TABLE "calendar_events" DROP COLUMN "mailbox_id";
  END IF;
END $$;
ALTER TABLE "calendar_events" ALTER COLUMN "owner_user_id" SET NOT NULL;
ALTER TABLE "calendar_events" DROP CONSTRAINT IF EXISTS "calendar_events_owner_user_id_fkey";
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "calendar_events_owner_user_id_idx";
CREATE INDEX IF NOT EXISTS "calendar_events_owner_user_id_start_at_idx" ON "calendar_events"("owner_user_id", "start_at");

-- ---- Google links: a person's own ----
ALTER TABLE "calendar_google_links" DROP COLUMN IF EXISTS "mailbox_id";
CREATE INDEX IF NOT EXISTS "calendar_google_links_linked_by_user_id_idx" ON "calendar_google_links"("linked_by_user_id");

-- ---- to-dos ----
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'todos' AND column_name = 'mailbox_id') THEN
    -- a to-do of the whole team becomes one to-do on each member's own list (each can tick it off for themselves)
    INSERT INTO "todos" ("id", "mailbox_id", "title", "description", "due_date", "assignee_id", "done_at", "done_by_id", "created_by_id", "created_at", "updated_at")
      SELECT 'tm' || md5(t."id" || p."user_id"), t."mailbox_id", t."title", t."description", t."due_date", p."user_id", t."done_at", t."done_by_id", t."created_by_id", t."created_at", t."updated_at"
      FROM "todos" t JOIN "mailbox_permissions" p ON p."mailbox_id" = t."mailbox_id" AND p."can_view"
      WHERE t."assignee_id" IS NULL
      ON CONFLICT DO NOTHING;
    DELETE FROM "todos" WHERE "assignee_id" IS NULL;
    DROP INDEX IF EXISTS "todos_mailbox_id_due_date_idx";
    ALTER TABLE "todos" DROP COLUMN "mailbox_id";
  END IF;
END $$;
ALTER TABLE "todos" ALTER COLUMN "assignee_id" SET NOT NULL;
ALTER TABLE "todos" DROP CONSTRAINT IF EXISTS "todos_assignee_id_fkey";
ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "todos_assignee_id_idx";
CREATE INDEX IF NOT EXISTS "todos_assignee_id_due_date_idx" ON "todos"("assignee_id", "due_date");
