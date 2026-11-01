-- the last time the person proved who they are again inside a session (for the actions that need a recent proof)
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "reauth_at" TIMESTAMP(3);
