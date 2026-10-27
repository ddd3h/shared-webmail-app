-- who last changed a receiving account on the owner's behalf (finance staff); NULL = the owner
ALTER TABLE "user_bank_accounts" ADD COLUMN IF NOT EXISTS "changed_by_id" TEXT;
