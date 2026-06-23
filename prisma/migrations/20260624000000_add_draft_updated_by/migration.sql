ALTER TABLE "drafts" ADD COLUMN "updated_by_id" TEXT;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
