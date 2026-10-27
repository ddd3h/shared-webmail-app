-- AlterTable: home address (profile) and the own-car mileage details of an expense claim
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "home_address" TEXT;
ALTER TABLE "expense_claims"
  ADD COLUMN IF NOT EXISTS "mileage_origin" TEXT,
  ADD COLUMN IF NOT EXISTS "mileage_destination" TEXT,
  ADD COLUMN IF NOT EXISTS "mileage_distance_m" INTEGER,
  ADD COLUMN IF NOT EXISTS "mileage_rate" INTEGER,
  ADD COLUMN IF NOT EXISTS "mileage_source" TEXT;
