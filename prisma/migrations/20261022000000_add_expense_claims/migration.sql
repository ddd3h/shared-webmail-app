-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expense_date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'personal',
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "reimbursed_at" DATE,
    "reimbursed_by_id" TEXT,
    "reimburse_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_receipts" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_claims_user_id_expense_date_idx" ON "expense_claims"("user_id", "expense_date");
CREATE INDEX "expense_claims_status_idx" ON "expense_claims"("status");
CREATE INDEX "expense_receipts_claim_id_idx" ON "expense_receipts"("claim_id");

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_reimbursed_by_id_fkey" FOREIGN KEY ("reimbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_receipts" ADD CONSTRAINT "expense_receipts_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
