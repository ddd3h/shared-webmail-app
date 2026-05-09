-- Drop the global unique constraint on external_message_id
-- and replace it with a composite unique (external_message_id, mailbox_id)
-- so the same message can be stored once per mailbox (e.g. CC'd to both
-- a personal and a team mailbox).

DROP INDEX IF EXISTS "messages_external_message_id_key";

ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_external_message_id_key";

CREATE UNIQUE INDEX "messages_external_message_id_mailbox_id_key"
  ON "messages"("external_message_id", "mailbox_id");
