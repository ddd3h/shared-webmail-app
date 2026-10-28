-- 給与の控除（社会保険料・雇用保険料・源泉所得税・住民税）の自動計算: 一人ひとりの登録、通勤手当、自動で作った明細を直した印
ALTER TABLE "fixed_pay_plans" ADD COLUMN IF NOT EXISTS "commute_amount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "auto_edited" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "payroll_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "birth_date" DATE,
    "health_insured" BOOLEAN NOT NULL DEFAULT true,
    "employment_insured" BOOLEAN NOT NULL DEFAULT true,
    "standard_monthly" INTEGER,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "resident_tax" INTEGER NOT NULL DEFAULT 0,
    "resident_tax_first" INTEGER,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_profiles_user_id_key" ON "payroll_profiles"("user_id");
DO $$ BEGIN
  ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
