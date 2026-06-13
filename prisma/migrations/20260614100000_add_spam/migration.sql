-- Add spam fields to threads
ALTER TABLE "threads" ADD COLUMN "is_spam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "threads" ADD COLUMN "spam_reason" TEXT;
ALTER TABLE "threads" ADD COLUMN "spam_flagged_at" TIMESTAMP(3);

-- Create spam_senders table
CREATE TABLE "spam_senders" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "spam_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spam_senders_type_address_key" ON "spam_senders"("type", "address");
CREATE INDEX "spam_senders_type_address_idx" ON "spam_senders"("type", "address");

ALTER TABLE "spam_senders" ADD CONSTRAINT "spam_senders_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
