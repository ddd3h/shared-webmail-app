-- CreateTable: 年末調整 declarations (one per person per year; the content is encrypted JSON)
CREATE TABLE IF NOT EXISTS "year_end_declarations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "data_enc" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "year_end_declarations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "year_end_declarations_user_id_year_key" ON "year_end_declarations"("user_id", "year");
CREATE INDEX IF NOT EXISTS "year_end_declarations_year_status_idx" ON "year_end_declarations"("year", "status");
DO $$ BEGIN
  ALTER TABLE "year_end_declarations" ADD CONSTRAINT "year_end_declarations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "year_end_declarations" ADD CONSTRAINT "year_end_declarations_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
