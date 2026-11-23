-- other addresses a session was confirmed from (the person proved who they are again after the address changed)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "confirmed_ips" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
