-- 所属を「人 × 部署 × 役職」にする: 1人が複数の部署に、部署ごとに別の役職で所属できる。
-- users.org_unit_id / position_id（1つだけ）と org_unit_extra_members（兼務）、org_units.head_user_id（部署長）は、先に新しい表へ移してから消す。

CREATE TABLE IF NOT EXISTS "org_memberships" (
    "user_id" TEXT NOT NULL,
    "unit_id" TEXT NOT NULL,
    "position_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("user_id", "unit_id")
);
CREATE INDEX IF NOT EXISTS "org_memberships_unit_id_idx" ON "org_memberships"("unit_id");
CREATE INDEX IF NOT EXISTS "org_memberships_position_id_idx" ON "org_memberships"("position_id");
DO $$ BEGIN
  ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "org_positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1) 主所属（人の役職は、これまで全部署で共通だったので、そのまま各所属の役職にする）
INSERT INTO "org_memberships" ("user_id", "unit_id", "position_id")
SELECT "id", "org_unit_id", "position_id" FROM "users" WHERE "org_unit_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2) 兼務（まだ無いDBでも動くように、あれば移す）
DO $$ BEGIN
  IF to_regclass('public.org_unit_extra_members') IS NOT NULL THEN
    INSERT INTO "org_memberships" ("user_id", "unit_id", "position_id")
    SELECT e."user_id", e."unit_id", u."position_id" FROM "org_unit_extra_members" e JOIN "users" u ON u."id" = e."user_id"
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- 3) 部署長: これまで「部署長として」効いていた承認・評価の範囲を保つため、部署長をその部署のメンバーにする（役職は本人のもの）
INSERT INTO "org_memberships" ("user_id", "unit_id", "position_id")
SELECT o."head_user_id", o."id", u."position_id" FROM "org_units" o JOIN "users" u ON u."id" = o."head_user_id" WHERE o."head_user_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4) 評価票は、部署ごとに1枚（評価者も部署ごと）。いまある票には、本人の主所属を入れる
ALTER TABLE "evaluations" ADD COLUMN IF NOT EXISTS "unit_id" TEXT;
UPDATE "evaluations" e SET "unit_id" = u."org_unit_id" FROM "users" u WHERE u."id" = e."user_id" AND e."unit_id" IS NULL;
DROP INDEX IF EXISTS "evaluations_cycle_id_user_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "evaluations_cycle_id_user_id_unit_id_key" ON "evaluations"("cycle_id", "user_id", "unit_id");
DO $$ BEGIN
  ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "org_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) 古い列と表を消す（中身は上で移した）
DROP TABLE IF EXISTS "org_unit_extra_members";
ALTER TABLE "users" DROP COLUMN IF EXISTS "org_unit_id" CASCADE;
ALTER TABLE "users" DROP COLUMN IF EXISTS "position_id" CASCADE;
ALTER TABLE "org_units" DROP COLUMN IF EXISTS "head_user_id" CASCADE;
