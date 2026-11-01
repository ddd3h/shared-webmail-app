-- 証憑 (receipts / invoices) uploaded to freee for a movement: which file became which freee receipt
ALTER TABLE "freee_exports" ADD COLUMN IF NOT EXISTS "receipt_map" JSONB;
