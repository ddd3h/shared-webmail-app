#!/bin/bash
set -e

# .env ファイルの存在確認
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please update .env with your actual database credentials and other secrets."
  else
    echo "Error: .env and .env.example not found."
    exit 1
  fi
fi

# DATABASE_URL の確認
if grep -q "CHANGE_ME" .env; then
  echo "Warning: .env still contains default values. Please edit .env before running this script if you are in production."
fi

echo "Running Prisma generate..."
npx prisma generate

# 開発環境か本番環境かの判断（簡易版）
if [ "$NODE_ENV" = "production" ]; then
  echo "Applying migrations to production database..."
  npx prisma migrate deploy
else
  echo "Running migrations for development..."
  # dev ではインタラクティブになる可能性があるが、CIなどで非インタラクティブにしたい場合は --skip-generate 等を検討
  npx prisma migrate dev --skip-seed
fi

echo "Seeding the database..."
npm run prisma:generate # Just in case
node prisma/seed.mjs

echo "Database setup completed successfully."
