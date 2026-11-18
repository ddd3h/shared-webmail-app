-- How many times an address was blocked automatically (the second time is permanent)
CREATE TABLE IF NOT EXISTS "ip_block_history" (
  "ip" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "last_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ip_block_history_pkey" PRIMARY KEY ("ip")
);
-- Addresses already blocked automatically before this release count once
INSERT INTO "ip_block_history" ("ip", "count")
SELECT "ip", 1 FROM "ip_blocks" WHERE "source" = 'auto'
ON CONFLICT ("ip") DO NOTHING;
