/*
  Warnings:

  - You are about to drop the column `team_id` on the `mailboxes` table. All the data in the column will be lost.
  - You are about to drop the `team_members` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `teams` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "mailboxes" DROP CONSTRAINT "mailboxes_team_id_fkey";

-- DropForeignKey
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_team_id_fkey";

-- DropForeignKey
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_user_id_fkey";

-- AlterTable
ALTER TABLE "mailboxes" DROP COLUMN "team_id";

-- DropTable
DROP TABLE "team_members";

-- DropTable
DROP TABLE "teams";
