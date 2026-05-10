-- Add last_login_at to users
ALTER TABLE "users" ADD COLUMN "last_login_at" TIMESTAMP(3);

-- Create mfi_snapshots table
CREATE TABLE "mfi_snapshots" (
    "id"           TEXT NOT NULL,
    "user_id"      TEXT NOT NULL,
    "recorded_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mfi"          DOUBLE PRECISION NOT NULL,
    "price"        DOUBLE PRECISION NOT NULL,
    "debt"         DOUBLE PRECISION NOT NULL,
    "volume"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "streak_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "mfi_snapshots_pkey" PRIMARY KEY ("id")
);

-- Index for time-series queries per user
CREATE INDEX "mfi_snapshots_user_id_recorded_at_idx" ON "mfi_snapshots"("user_id", "recorded_at");

-- Foreign key to users
ALTER TABLE "mfi_snapshots" ADD CONSTRAINT "mfi_snapshots_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
