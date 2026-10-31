-- an approval is of the payee's bank details as they were then: a fingerprint of them is kept with the request, and paying to details that changed since is refused
ALTER TABLE "payment_requests" ADD COLUMN IF NOT EXISTS "approved_account_fp" TEXT;

-- requests already approved: the details as they are now (what the approver saw is not known any more)
UPDATE "payment_requests" r SET "approved_account_fp" = encode(sha256(convert_to(
  coalesce(v."bank_code", '') || '|' || coalesce(v."branch_code", '') || '|' || v."account_type" || '|' || v."account_number_enc" || '|' || v."account_last4" || '|' || v."account_holder", 'UTF8')), 'hex')
FROM "payment_vendors" v
WHERE v."id" = r."vendor_id" AND r."status" = 'approved' AND r."approved_account_fp" IS NULL;
