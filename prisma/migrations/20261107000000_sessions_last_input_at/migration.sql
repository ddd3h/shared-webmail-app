-- AlterTable: when the person last did something (idle logout)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "last_input_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
