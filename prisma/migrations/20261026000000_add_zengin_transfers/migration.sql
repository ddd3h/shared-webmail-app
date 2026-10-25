-- AlterTable
ALTER TABLE "users" ADD COLUMN "is_accounting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "payment_requests" ADD COLUMN "batch_id" TEXT;
ALTER TABLE "payslips" ADD COLUMN "batch_id" TEXT;

-- CreateTable
CREATE TABLE "user_bank_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "branch_code" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_batches" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "transfer_date" DATE NOT NULL,
    "item_count" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_b64" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" DATE,
    "paid_by_id" TEXT,

    CONSTRAINT "transfer_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_bank_accounts_user_id_key" ON "user_bank_accounts"("user_id");
CREATE INDEX "transfer_batches_created_at_idx" ON "transfer_batches"("created_at");
CREATE INDEX "payment_requests_batch_id_idx" ON "payment_requests"("batch_id");
CREATE INDEX "payslips_batch_id_idx" ON "payslips"("batch_id");

-- AddForeignKey
ALTER TABLE "user_bank_accounts" ADD CONSTRAINT "user_bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_bank_accounts" ADD CONSTRAINT "user_bank_accounts_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_batches" ADD CONSTRAINT "transfer_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "transfer_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "transfer_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
