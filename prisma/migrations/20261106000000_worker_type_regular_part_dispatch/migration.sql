-- AlterEnum: 正社員 / パート / 派遣 (existing "employee" stays as it is)
ALTER TYPE "WorkerType" ADD VALUE IF NOT EXISTS 'regular';
ALTER TYPE "WorkerType" ADD VALUE IF NOT EXISTS 'part';
ALTER TYPE "WorkerType" ADD VALUE IF NOT EXISTS 'dispatch';
