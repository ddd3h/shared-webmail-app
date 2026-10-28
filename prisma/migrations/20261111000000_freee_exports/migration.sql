-- CreateTable: what became of sending each money movement to freee
CREATE TABLE IF NOT EXISTS "freee_exports" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "paid_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "freee_deal_id" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freee_exports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "freee_exports_source_type_source_id_key" ON "freee_exports"("source_type", "source_id");
CREATE INDEX IF NOT EXISTS "freee_exports_status_idx" ON "freee_exports"("status");
CREATE INDEX IF NOT EXISTS "freee_exports_paid_date_idx" ON "freee_exports"("paid_date");
