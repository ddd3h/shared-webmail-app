-- CreateTable
CREATE TABLE "payment_vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_kana" TEXT,
    "bank_name" TEXT NOT NULL,
    "bank_code" TEXT,
    "branch_name" TEXT NOT NULL,
    "branch_code" TEXT,
    "account_type" TEXT NOT NULL,
    "account_number_enc" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "deduction_amount" INTEGER NOT NULL DEFAULT 0,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "fee_bearer" TEXT NOT NULL DEFAULT 'us',
    "invoice_number" TEXT,
    "invoice_date" DATE,
    "due_date" DATE NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_comment" TEXT,
    "paid_at" DATE,
    "paid_by_id" TEXT,
    "paid_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_documents" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_vendors_name_idx" ON "payment_vendors"("name");
CREATE INDEX "payment_requests_user_id_due_date_idx" ON "payment_requests"("user_id", "due_date");
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");
CREATE INDEX "payment_requests_vendor_id_invoice_number_idx" ON "payment_requests"("vendor_id", "invoice_number");
CREATE INDEX "payment_documents_request_id_idx" ON "payment_documents"("request_id");

-- AddForeignKey
ALTER TABLE "payment_vendors" ADD CONSTRAINT "payment_vendors_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_vendors" ADD CONSTRAINT "payment_vendors_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "payment_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_documents" ADD CONSTRAINT "payment_documents_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
