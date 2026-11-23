-- Pictures fetched from Mattermost and the internet, kept across restarts (src/lib/image-store.ts)
CREATE TABLE IF NOT EXISTS "image_cache" (
    "key" TEXT NOT NULL,
    "user_id" TEXT,
    "owner" TEXT,
    "data" BYTEA,
    "content_type" TEXT,
    "etag" TEXT,
    "source" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "image_cache_pkey" PRIMARY KEY ("key")
);
CREATE INDEX IF NOT EXISTS "image_cache_fetched_at_idx" ON "image_cache"("fetched_at");
CREATE INDEX IF NOT EXISTS "image_cache_user_id_idx" ON "image_cache"("user_id");
DO $$ BEGIN
  ALTER TABLE "image_cache" ADD CONSTRAINT "image_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
