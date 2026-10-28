-- CreateIndex: failed logins of the last 24 hours (security overview) are counted and grouped from this index
CREATE INDEX "login_logs_success_created_at_idx" ON "login_logs"("success", "created_at");
