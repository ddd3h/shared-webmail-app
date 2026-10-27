-- AlterTable: the public-transport route behind a 交通費 claim
ALTER TABLE "expense_claims"
  ADD COLUMN IF NOT EXISTS "transit_from" TEXT,
  ADD COLUMN IF NOT EXISTS "transit_to" TEXT,
  ADD COLUMN IF NOT EXISTS "transit_summary" TEXT;
