-- オートフロー: 送信記録（同じ宛先・同じ段階を二度送らない）と、1日1回の実行の記録
CREATE TABLE IF NOT EXISTS "autoflow_notices" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "autoflow_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "autoflow_notices_rule_stage_subject_key_user_id_key" ON "autoflow_notices"("rule", "stage", "subject_key", "user_id");
CREATE INDEX IF NOT EXISTS "autoflow_notices_created_at_idx" ON "autoflow_notices"("created_at");

CREATE TABLE IF NOT EXISTS "autoflow_runs" (
    "id" TEXT NOT NULL,
    "run_date" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "summary" TEXT,

    CONSTRAINT "autoflow_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "autoflow_runs_run_date_key" ON "autoflow_runs"("run_date");
