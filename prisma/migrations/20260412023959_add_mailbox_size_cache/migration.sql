-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "cached_size_bytes" BIGINT,
ADD COLUMN     "size_cached_at" TIMESTAMP(3);
