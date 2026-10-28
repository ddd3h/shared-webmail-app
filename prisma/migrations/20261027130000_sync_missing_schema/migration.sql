-- A database built from the migrations alone differed from schema.prisma (the missing parts had been added with `prisma db push`).
-- Everything here is "if missing", so it changes nothing on a database that already has it.

-- drafts: the quoted part of a reply
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "quote_header" TEXT;
ALTER TABLE "drafts" ADD COLUMN IF NOT EXISTS "quote_html" TEXT;

-- login_logs: every login attempt
CREATE TABLE IF NOT EXISTS "login_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "network_type" TEXT,
    "org_name" TEXT,
    "country" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "login_logs_created_at_idx" ON "login_logs"("created_at");
CREATE INDEX IF NOT EXISTS "login_logs_ip_address_idx" ON "login_logs"("ip_address");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'login_logs_user_id_fkey') THEN
    ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- spam_senders.created_by_id is optional: deleting the person who added a sender must not be blocked (SET NULL, as in schema.prisma)
ALTER TABLE "spam_senders" DROP CONSTRAINT IF EXISTS "spam_senders_created_by_id_fkey";
ALTER TABLE "spam_senders" ADD CONSTRAINT "spam_senders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
