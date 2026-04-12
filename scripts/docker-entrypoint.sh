#!/bin/sh
set -e

echo "[entrypoint] Waiting for database..."
# 最大30秒DBの起動を待つ
for i in $(seq 1 30); do
  node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null && break
  echo "[entrypoint] DB not ready, retrying ($i/30)..."
  sleep 2
done

echo "[entrypoint] Running database migrations..."
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Starting application..."
exec node server.js
