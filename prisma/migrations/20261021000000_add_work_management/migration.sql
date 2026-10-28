-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('executive', 'employee', 'contractor');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "worker_type" "WorkerType" NOT NULL DEFAULT 'employee';

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "work_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "break_started_at" TIMESTAMP(3),
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "edited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "report_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hours" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "pay_month" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '給与',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "pay_date" DATE,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_items" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payslip_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_user_id_work_date_key" ON "attendance_records"("user_id", "work_date");
CREATE INDEX "work_reports_user_id_report_date_idx" ON "work_reports"("user_id", "report_date");
CREATE INDEX "payslips_user_id_pay_month_idx" ON "payslips"("user_id", "pay_month");
CREATE INDEX "payslips_pay_month_idx" ON "payslips"("pay_month");
CREATE INDEX "payslip_items_payslip_id_idx" ON "payslip_items"("payslip_id");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_reports" ADD CONSTRAINT "work_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
