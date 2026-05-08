-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "sync_mode" TEXT NOT NULL DEFAULT 'poll';
