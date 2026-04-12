/*
  Warnings:

  - You are about to drop the column `mattermost_username` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "mattermost_username";
