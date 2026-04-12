#!/bin/bash
# 初回セットアップスクリプト
# 使い方: bash scripts/setup.sh

set -e

if [ -f .env ]; then
  echo ".env が既に存在します。上書きしますか？ [y/N]"
  read -r answer
  if [ "$answer" != "y" ] && [ "$answer" != "Y" ]; then
    echo "キャンセルしました。"
    exit 0
  fi
fi

echo "シークレットを生成中..."

SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n=/')
ENCRYPTION_KEY_HEX=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '\n=/')
CRON_SECRET=$(openssl rand -base64 32 | tr -d '\n=/')

cat > .env << EOF
# ---- データベース ----
DATABASE_URL="postgresql://webmail:${POSTGRES_PASSWORD}@db:5432/webmail_app"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD}"

# ---- セッション暗号化 ----
SESSION_SECRET="${SESSION_SECRET}"

# ---- メールパスワード暗号化キー ----
ENCRYPTION_KEY_HEX="${ENCRYPTION_KEY_HEX}"
ENCRYPTION_KEY_VERSION="v1"

# ---- アプリURL ----
# 本番ドメインに変更してください
NEXT_PUBLIC_APP_URL="https://mail.example.com"

# ---- CRON認証 ----
CRON_SECRET="${CRON_SECRET}"

# ---- Web Push (管理画面から生成してください) ----
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:admin@example.com"

# ---- Mattermost連携 (任意) ----
MATTERMOST_BASE_URL=""
MATTERMOST_BOT_TOKEN=""
MATTERMOST_DEFAULT_CHANNEL_ID=""
EOF

echo ""
echo ".env を生成しました。"
echo ""
echo "次のステップ:"
echo "  1. .env の NEXT_PUBLIC_APP_URL をドメインに変更"
echo "  2. docker compose up -d --build"
echo "  3. 初回のみ: docker compose exec app node prisma/seed.mjs"
echo "     → admin@example.com / admin1234 でログイン後、管理画面でVAPID生成"
