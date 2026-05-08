-- Replace cuid-based token column with token_hash (SHA-256 hex of raw token).
-- Existing tokens were generated with cuid() (not cryptographically random for
-- secret URLs), so they are all deleted here. Users must request a new reset link.

DELETE FROM "password_reset_tokens";

-- Drop the old column before adding the new one
ALTER TABLE "password_reset_tokens" DROP COLUMN "token";

-- Add token_hash column (NOT NULL, UNIQUE)
ALTER TABLE "password_reset_tokens" ADD COLUMN "token_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "password_reset_tokens" ALTER COLUMN "token_hash" DROP DEFAULT;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_token_hash_key" UNIQUE ("token_hash");
