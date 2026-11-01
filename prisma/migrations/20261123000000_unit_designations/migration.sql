-- the people a 部署 names itself: the approvers of its expense claims (kind 'expense') and the evaluators of its members (kind 'evaluation').
-- none named = the 役職 permissions decide, as before
CREATE TABLE IF NOT EXISTS "org_unit_designations" (
  "unit_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_unit_designations_pkey" PRIMARY KEY ("unit_id", "user_id", "kind")
);
CREATE INDEX IF NOT EXISTS "org_unit_designations_user_id_idx" ON "org_unit_designations"("user_id");
DO $$ BEGIN
  ALTER TABLE "org_unit_designations" ADD CONSTRAINT "org_unit_designations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_unit_designations" ADD CONSTRAINT "org_unit_designations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
