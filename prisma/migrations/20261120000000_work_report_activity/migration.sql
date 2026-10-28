-- 準業務委託の業務報告書: ログインの少ない期間の報告を、警告を読んだうえで提出した印
ALTER TABLE "work_reports" ADD COLUMN IF NOT EXISTS "activity_flag" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "work_reports" ADD COLUMN IF NOT EXISTS "activity_note" TEXT;
ALTER TABLE "work_reports" ADD COLUMN IF NOT EXISTS "activity_ack_at" TIMESTAMP(3);

-- 「この人が最後にログインしたのはいつか」を引くための索引
CREATE INDEX IF NOT EXISTS "login_logs_user_id_created_at_idx" ON "login_logs"("user_id", "created_at");
