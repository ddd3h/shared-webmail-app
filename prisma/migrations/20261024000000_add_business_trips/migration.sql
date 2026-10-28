-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN "trip_id" TEXT;

-- CreateTable
CREATE TABLE "business_trips" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_allowance_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_allowance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_allowance_lines" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "type_id" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trip_allowance_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_claims_trip_id_idx" ON "expense_claims"("trip_id");
CREATE INDEX "business_trips_user_id_start_date_idx" ON "business_trips"("user_id", "start_date");
CREATE INDEX "business_trips_status_idx" ON "business_trips"("status");
CREATE INDEX "trip_allowance_lines_trip_id_idx" ON "trip_allowance_lines"("trip_id");

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "business_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_trips" ADD CONSTRAINT "business_trips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_trips" ADD CONSTRAINT "business_trips_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trip_allowance_lines" ADD CONSTRAINT "trip_allowance_lines_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "business_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_allowance_lines" ADD CONSTRAINT "trip_allowance_lines_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "trip_allowance_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sample rates so a fresh install has something to pick from. Edit them under 出張 > 手当の設定.
INSERT INTO "trip_allowance_types" ("id", "name", "kind", "unit", "amount", "description", "sort", "updated_at") VALUES
  ('tat_domestic', '国内出張日当', 'daily', 'per_day', 3000, '国内への出張（1日あたり）', 10, CURRENT_TIMESTAMP),
  ('tat_overseas', '海外出張日当', 'daily', 'per_day', 6000, '海外への出張（1日あたり）', 20, CURRENT_TIMESTAMP),
  ('tat_onsite', '現場作業手当', 'addon', 'per_day', 1000, '客先・現場での作業がある場合（1日あたり）', 30, CURRENT_TIMESTAMP),
  ('tat_resident', '客先常駐手当', 'addon', 'per_day', 2000, '客先に常駐して業務を行う場合（1日あたり）', 40, CURRENT_TIMESTAMP),
  ('tat_lodging', '宿泊手当', 'addon', 'per_night', 2000, '宿泊を伴う場合（1泊あたり・宿泊料の実費とは別）', 50, CURRENT_TIMESTAMP),
  ('tat_event', '展示会・イベント対応手当', 'addon', 'per_trip', 5000, '展示会やイベントでの対応がある場合（1回あたり）', 60, CURRENT_TIMESTAMP);
