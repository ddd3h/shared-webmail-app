-- AlterTable: "keep me logged in" of the installed app, proved by a device-bound key
ALTER TABLE "known_devices" ADD COLUMN "remember_until" TIMESTAMP(3),
ADD COLUMN "public_key" TEXT,
ADD COLUMN "key_id" TEXT,
ADD COLUMN "device_fp" TEXT;

-- CreateIndex
CREATE INDEX "known_devices_key_id_idx" ON "known_devices"("key_id");
