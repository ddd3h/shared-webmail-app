-- Channels the "Mattermostで議論" button can post to (registered by the system admin) and, for private ones, who may use them
CREATE TABLE IF NOT EXISTS "mattermost_channels" (
  "id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'public',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mattermost_channels_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "mattermost_channels_channel_id_key" ON "mattermost_channels"("channel_id");

CREATE TABLE IF NOT EXISTS "mattermost_channel_users" (
  "channel_ref_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mattermost_channel_users_pkey" PRIMARY KEY ("channel_ref_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "mattermost_channel_users_user_id_idx" ON "mattermost_channel_users"("user_id");
DO $$ BEGIN
  ALTER TABLE "mattermost_channel_users" ADD CONSTRAINT "mattermost_channel_users_channel_ref_id_fkey" FOREIGN KEY ("channel_ref_id") REFERENCES "mattermost_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mattermost_channel_users" ADD CONSTRAINT "mattermost_channel_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
