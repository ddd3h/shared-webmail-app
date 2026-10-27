-- CreateTable: shared mailboxes a person has chosen not to see in their 共有メール view
CREATE TABLE IF NOT EXISTS "hidden_team_mailboxes" (
    "user_id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hidden_team_mailboxes_pkey" PRIMARY KEY ("user_id", "mailbox_id")
);
DO $$ BEGIN
  ALTER TABLE "hidden_team_mailboxes" ADD CONSTRAINT "hidden_team_mailboxes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hidden_team_mailboxes" ADD CONSTRAINT "hidden_team_mailboxes_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
