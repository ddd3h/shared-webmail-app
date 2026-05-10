-- 1. Remove is_archived column from threads
ALTER TABLE "threads" DROP COLUMN "is_archived";

-- 2. Modify ThreadStatus enum across all dependent tables
-- Clear defaults
ALTER TABLE "threads" ALTER COLUMN "status" DROP DEFAULT;

-- Rename old type
ALTER TYPE "ThreadStatus" RENAME TO "ThreadStatus_old";

-- Create new type
CREATE TYPE "ThreadStatus" AS ENUM ('open', 'in_progress', 'waiting', 'done');

-- Alter columns to new type
ALTER TABLE "threads" ALTER COLUMN "status" TYPE "ThreadStatus" USING ("status"::text::"ThreadStatus");
ALTER TABLE "thread_state_history" ALTER COLUMN "new_status" TYPE "ThreadStatus" USING ("new_status"::text::"ThreadStatus");
ALTER TABLE "thread_state_history" ALTER COLUMN "old_status" TYPE "ThreadStatus" USING ("old_status"::text::"ThreadStatus");

-- Restore default
ALTER TABLE "threads" ALTER COLUMN "status" SET DEFAULT 'open';

-- Cleanup
DROP TYPE "ThreadStatus_old";
