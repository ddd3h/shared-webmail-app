-- the 部署 a person claims for (chosen when applying): its approvers decide the claim
ALTER TABLE "expense_claims" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
CREATE INDEX IF NOT EXISTS "expense_claims_unit_id_idx" ON "expense_claims"("unit_id");
DO $$ BEGIN
  ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- claims already made: a person in exactly one 部署 claims for it (people in several 部署 keep "not chosen", which any of their approvers may decide)
UPDATE "expense_claims" c SET "unit_id" = m."unit_id"
FROM (SELECT "user_id", MIN("unit_id") AS "unit_id" FROM "org_memberships" GROUP BY "user_id" HAVING COUNT(*) = 1) m
WHERE m."user_id" = c."user_id" AND c."unit_id" IS NULL;
