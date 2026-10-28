-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN "payslip_id" TEXT;
ALTER TABLE "payslip_items" ADD COLUMN "system_key" TEXT;

-- CreateIndex
CREATE INDEX "expense_claims_payslip_id_idx" ON "expense_claims"("payslip_id");

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
