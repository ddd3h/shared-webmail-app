-- 役員報酬・準業務委託の固定の月額と、その月だけの加算・賞与。オートフローが毎月、給与明細（支払予定）の下書きを作る
ALTER TABLE "payslips" ADD COLUMN IF NOT EXISTS "auto_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "payslips_auto_key_key" ON "payslips"("auto_key");

CREATE TABLE IF NOT EXISTS "fixed_pay_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "starts_month" TEXT NOT NULL,
    "ends_month" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_pay_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "fixed_pay_plans_user_id_idx" ON "fixed_pay_plans"("user_id");
DO $$ BEGIN
  ALTER TABLE "fixed_pay_plans" ADD CONSTRAINT "fixed_pay_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "pay_extras" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pay_month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_extras_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "pay_extras_user_id_pay_month_idx" ON "pay_extras"("user_id", "pay_month");
DO $$ BEGIN
  ALTER TABLE "pay_extras" ADD CONSTRAINT "pay_extras_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
