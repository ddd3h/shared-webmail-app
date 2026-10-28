-- CreateTable: 締め日・振込日 per kind of worker
CREATE TABLE IF NOT EXISTS "pay_schedules" (
    "worker_type" "WorkerType" NOT NULL,
    "closing_day" INTEGER NOT NULL DEFAULT 0,
    "pay_month_offset" INTEGER NOT NULL DEFAULT 1,
    "pay_day" INTEGER NOT NULL DEFAULT 25,
    "pay_day_shift" TEXT NOT NULL DEFAULT 'before',
    "report_deadline_days" INTEGER NOT NULL DEFAULT 5,
    "expense_deadline_days" INTEGER NOT NULL DEFAULT 5,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_schedules_pkey" PRIMARY KEY ("worker_type")
);
