-- AlterTable: an expense reimbursement can go into a (monthly) 全銀 file
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "batch_id" TEXT;
CREATE INDEX IF NOT EXISTS "expense_claims_batch_id_idx" ON "expense_claims"("batch_id");
DO $$ BEGIN
  ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "transfer_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
