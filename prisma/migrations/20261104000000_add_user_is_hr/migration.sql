-- AlterTable: 人事担当 flag (like 経理担当): all evaluations, regardless of the organisation
ALTER TABLE "users" ADD COLUMN "is_hr" BOOLEAN NOT NULL DEFAULT false;
