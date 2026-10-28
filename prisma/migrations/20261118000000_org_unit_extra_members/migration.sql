-- 兼務: additional 部署 of a person (the main one stays in users.org_unit_id)
CREATE TABLE IF NOT EXISTS "org_unit_extra_members" (
    "user_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_unit_extra_members_pkey" PRIMARY KEY ("user_id", "unit_id")
);
CREATE INDEX IF NOT EXISTS "org_unit_extra_members_unit_id_idx" ON "org_unit_extra_members"("unit_id");
DO $$ BEGIN
  ALTER TABLE "org_unit_extra_members" ADD CONSTRAINT "org_unit_extra_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_unit_extra_members" ADD CONSTRAINT "org_unit_extra_members_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
