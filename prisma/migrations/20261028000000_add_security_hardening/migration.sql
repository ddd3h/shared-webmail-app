-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "device_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "first_ip" TEXT NOT NULL,
    "last_ip" TEXT NOT NULL,
    "country" TEXT,
    "city" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_blocks" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "expires_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ip_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "ip" TEXT,
    "user_id" TEXT,
    "email" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_token_hash_key" ON "known_devices"("token_hash");

-- CreateIndex
CREATE INDEX "known_devices_user_id_idx" ON "known_devices"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ip_blocks_ip_key" ON "ip_blocks"("ip");

-- CreateIndex
CREATE INDEX "ip_blocks_expires_at_idx" ON "ip_blocks"("expires_at");

-- CreateIndex
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");

-- CreateIndex
CREATE INDEX "security_events_type_idx" ON "security_events"("type");

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

