#!/usr/bin/env bash
# =============================================================================
#  Shared Mail Workspace — 本番環境フルセットアップスクリプト
#  Ubuntu 22.04 / 24.04 (Debian 系) 対応
#
#  使い方:
#    sudo bash scripts/production-setup.sh
# =============================================================================

set -euo pipefail

# ── カラー定義 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✘${RESET}  $*"; }
step() { echo -e "\n${BOLD}${CYAN}▸ $*${RESET}"; }
hr()   { echo -e "${CYAN}$(printf '─%.0s' {1..60})${RESET}"; }

# ── ルート確認 ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  err "このスクリプトは sudo (root) で実行してください"
  echo "  例: sudo bash scripts/production-setup.sh"
  exit 1
fi

# ── スクリプトのディレクトリを APP_DIR に設定 ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

hr
echo -e "${BOLD}  Shared Mail Workspace — 本番環境セットアップ${RESET}"
echo "  アプリディレクトリ: ${APP_DIR}"
hr

# ── OS 確認 ──────────────────────────────────────────────────────────────────
step "OS を確認しています..."
if [[ ! -f /etc/os-release ]]; then
  err "OS の判別に失敗しました (/etc/os-release が見つかりません)"
  exit 1
fi
source /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
  warn "このスクリプトは Ubuntu / Debian 向けに設計されています (検出: $ID $VERSION_ID)"
  warn "他の OS では apt コマンドが使えない場合があります"
  read -rp "続行しますか？ [y/N]: " _cont
  [[ "$_cont" =~ ^[yY]$ ]] || { info "中断しました"; exit 0; }
fi
ok "OS: $PRETTY_NAME"

# ── ヘルパー関数 ──────────────────────────────────────────────────────────────
ask_install() {
  # $1=ソフト名, $2=確認コマンド, $3=自動インストール関数名
  local name="$1" check_cmd="$2" install_fn="$3"
  if eval "$check_cmd" &>/dev/null; then
    ok "$name は既にインストール済みです"
    return 0
  fi
  warn "$name が見つかりません"
  echo -e "  [1] 自動インストール  [2] 手動でインストール後に続行  [3] スキップ"
  read -rp "  選択 [1/2/3]: " choice
  case "$choice" in
    1) "$install_fn" ;;
    2)
      echo -e "  ${YELLOW}$name を手動でインストールしてから Enter を押してください...${RESET}"
      read -r
      if ! eval "$check_cmd" &>/dev/null; then
        err "$name が見つかりません。スキップして続行します"
      fi
      ;;
    *) warn "$name をスキップしました（後で問題が発生する可能性があります）" ;;
  esac
}

# ── Node.js 確認・インストール ─────────────────────────────────────────────
REQUIRED_NODE_MAJOR=20

install_node() {
  step "Node.js ${REQUIRED_NODE_MAJOR} LTS をインストールしています..."
  apt-get update -qq
  apt-get install -y curl ca-certificates
  curl -fsSL "https://deb.nodesource.com/setup_${REQUIRED_NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) をインストールしました"
}

check_node() {
  node --version &>/dev/null || return 1
  local major; major=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
  [[ "$major" -ge "$REQUIRED_NODE_MAJOR" ]] || return 1
}

step "Node.js を確認しています（${REQUIRED_NODE_MAJOR}+ が必要）..."
if check_node; then
  ok "Node.js $(node -v)"
else
  ask_install "Node.js ${REQUIRED_NODE_MAJOR}+" "check_node" "install_node"
fi

# ── npm 確認 ──────────────────────────────────────────────────────────────────
step "npm を確認しています..."
if npm --version &>/dev/null; then
  ok "npm $(npm -v)"
else
  warn "npm が見つかりません。Node.js と同時にインストールされるはずです"
fi

# ── PostgreSQL 確認・インストール ─────────────────────────────────────────────
REQUIRED_PG_MAJOR=14

install_postgres() {
  step "PostgreSQL ${REQUIRED_PG_MAJOR} をインストールしています..."
  apt-get update -qq
  apt-get install -y postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
  ok "PostgreSQL $(psql --version | awk '{print $3}') をインストールしました"
}

check_pg() {
  psql --version &>/dev/null || return 1
  local major; major=$(psql --version | grep -oP '\d+' | head -1)
  [[ "$major" -ge "$REQUIRED_PG_MAJOR" ]] || return 1
}

step "PostgreSQL を確認しています（${REQUIRED_PG_MAJOR}+ が必要）..."
if check_pg; then
  ok "PostgreSQL $(psql --version | awk '{print $3}')"
else
  ask_install "PostgreSQL ${REQUIRED_PG_MAJOR}+" "check_pg" "install_postgres"
fi

# ── PM2 確認・インストール ─────────────────────────────────────────────────
install_pm2() {
  npm install -g pm2
  ok "PM2 $(pm2 -v) をインストールしました"
}

step "PM2 を確認しています..."
if pm2 --version &>/dev/null; then
  ok "PM2 $(pm2 -v)"
else
  ask_install "PM2" "pm2 --version" "install_pm2"
fi

# ── certbot 確認・インストール ─────────────────────────────────────────────
install_certbot() {
  apt-get update -qq
  apt-get install -y certbot python3-certbot-nginx
  ok "certbot $(certbot --version 2>&1 | head -1) をインストールしました"
}

step "certbot (Let's Encrypt) を確認しています..."
if certbot --version &>/dev/null; then
  ok "certbot $(certbot --version 2>&1 | head -1)"
else
  ask_install "certbot" "certbot --version" "install_certbot"
fi

# ── Nginx 確認・インストール ───────────────────────────────────────────────
install_nginx() {
  apt-get update -qq
  apt-get install -y nginx
  systemctl enable nginx
  systemctl start nginx
  ok "Nginx $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+')"
}

step "Nginx を確認しています..."
if nginx -v &>/dev/null; then
  ok "Nginx $(nginx -v 2>&1 | grep -oP 'nginx/[\d.]+')"
else
  ask_install "Nginx" "nginx -v" "install_nginx"
fi

# ── PostgreSQL ユーザー・DB 設定 ───────────────────────────────────────────
step "PostgreSQL ユーザーとデータベースを設定します..."
hr

echo -e "\n${BOLD}PostgreSQL 設定${RESET}"
read -rp "  DBユーザー名 [webmail]: " DB_USER
DB_USER="${DB_USER:-webmail}"

read -rsp "  DBパスワード（空の場合は自動生成）: " DB_PASS_INPUT; echo
if [[ -z "$DB_PASS_INPUT" ]]; then
  DB_PASS=$(openssl rand -base64 24 | tr -d '\n=/+')
  ok "パスワードを自動生成しました"
else
  DB_PASS="$DB_PASS_INPUT"
fi

read -rp "  DB名 [webmail_app]: " DB_NAME
DB_NAME="${DB_NAME:-webmail_app}"

# PostgreSQL サービスが起動しているか確認
if ! systemctl is-active --quiet postgresql 2>/dev/null; then
  warn "PostgreSQL が起動していません。起動を試みます..."
  systemctl start postgresql || { err "PostgreSQL の起動に失敗しました"; exit 1; }
fi

info "ユーザー「${DB_USER}」を作成しています..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" \
  | grep -q 1 && {
    info "ユーザー「${DB_USER}」は既に存在します。パスワードを更新します"
    sudo -u postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" >/dev/null
  } || {
    sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}' CREATEDB;" >/dev/null
    ok "ユーザー「${DB_USER}」を作成しました"
  }

info "データベース「${DB_NAME}」を確認しています..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" \
  | grep -q 1 && {
    info "データベース「${DB_NAME}」は既に存在します"
  } || {
    sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null
    ok "データベース「${DB_NAME}」を作成しました"
  }

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};" >/dev/null
ok "権限を付与しました"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"

# ── .env 設定 ─────────────────────────────────────────────────────────────────
step ".env を設定します..."
hr

echo -e "\n${BOLD}.env 設定${RESET}"

read -rp "  アプリの公開URL（例: https://mail.example.com）: " APP_URL
APP_URL="${APP_URL:-http://localhost:3000}"

read -rp "  管理者メールアドレス [admin@example.com]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"

# Node.js ポート
read -rp "  Node.js ポート番号 [3000]: " APP_PORT
APP_PORT="${APP_PORT:-3000}"

# 自動生成するシークレット
SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n=/')
ENCRYPTION_KEY_HEX=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -base64 32 | tr -d '\n=/')

# OpenRouter (AI機能)
echo ""
read -rsp "  OpenRouter APIキー（AI返信機能・空でスキップ）: " OPENROUTER_KEY; echo
read -rp "  OpenRouterモデル [anthropic/claude-3.5-haiku]: " OPENROUTER_MODEL
OPENROUTER_MODEL="${OPENROUTER_MODEL:-anthropic/claude-3.5-haiku}"

# Mattermost (任意)
echo ""
read -rp "  Mattermost URL（任意・空でスキップ）: " MM_URL
read -rsp "  Mattermost Bot Token（任意）: " MM_TOKEN; echo
read -rp "  Mattermost デフォルトチャンネルID（任意）: " MM_CHANNEL

ENV_FILE="${APP_DIR}/.env"
ENV_BACKUP=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
  cp "$ENV_FILE" "$ENV_BACKUP"
  warn "既存の .env を ${ENV_BACKUP} にバックアップしました"
fi

cat > "$ENV_FILE" << ENVEOF
# ═══════════════════════════════════════════════════════
#  Shared Mail Workspace — 本番環境設定
#  生成日時: $(date '+%Y-%m-%d %H:%M:%S')
# ═══════════════════════════════════════════════════════

# ---- データベース (PostgreSQL) ----
DATABASE_URL="${DATABASE_URL}"

# ---- セッション暗号化 ----
SESSION_SECRET="${SESSION_SECRET}"

# ---- メールパスワード暗号化キー ----
ENCRYPTION_KEY_HEX="${ENCRYPTION_KEY_HEX}"
ENCRYPTION_KEY_VERSION="v1"

# ---- アプリURL ----
NEXT_PUBLIC_APP_URL="${APP_URL}"
PORT=${APP_PORT}

# ---- CRON認証 ----
CRON_SECRET="${CRON_SECRET}"

# ---- OpenRouter AI ----
OPENROUTER_API_KEY="${OPENROUTER_KEY:-}"
OPENROUTER_MODEL="${OPENROUTER_MODEL}"

# ---- Web Push / PWA通知 (管理画面から生成してください) ----
VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:${ADMIN_EMAIL}"

# ---- Mattermost連携 (任意) ----
MATTERMOST_BASE_URL="${MM_URL:-}"
MATTERMOST_BOT_TOKEN="${MM_TOKEN:-}"
MATTERMOST_DEFAULT_CHANNEL_ID="${MM_CHANNEL:-}"
ENVEOF

chmod 600 "$ENV_FILE"
ok ".env を生成しました（パーミッション 600）"

# ── npm install & Prisma ──────────────────────────────────────────────────────
step "npm パッケージをインストールしています..."
cd "$APP_DIR"
npm ci --prefer-offline 2>&1 | tail -3 || npm install
ok "npm install 完了"

step "Prisma クライアントを生成しています..."
npx prisma generate
ok "prisma generate 完了"

step "データベースマイグレーションを実行しています..."
npx prisma migrate deploy
ok "マイグレーション完了"

# ── npm run build ─────────────────────────────────────────────────────────────
step "アプリケーションをビルドしています（数分かかります）..."
npm run build
ok "ビルド完了"

# standalone モードのスタティックファイルをコピー
if [[ -d ".next/standalone" ]]; then
  info "standalone モード用ファイルをコピーしています..."
  cp -r public .next/standalone/
  cp -r .next/static .next/standalone/.next/static
  ok "standalone ファイルコピー完了"
fi

# ── PM2 設定 ──────────────────────────────────────────────────────────────────
step "PM2 設定ファイルを生成しています..."

cat > "${APP_DIR}/ecosystem.config.js" << PMEOF
// PM2 エコシステム設定
// 使い方: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'webmail-app',
      script: '.next/standalone/server.js',
      cwd: '${APP_DIR}',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: ${APP_PORT},
        HOSTNAME: '0.0.0.0',
      },
      error_file: '/var/log/pm2/webmail-error.log',
      out_file:   '/var/log/pm2/webmail-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
    },
  ],
};
PMEOF

ok "ecosystem.config.js を生成しました"

mkdir -p /var/log/pm2

# アプリを起動 or 再起動
if pm2 describe webmail-app &>/dev/null; then
  pm2 reload ecosystem.config.js --update-env
  ok "PM2 プロセスをリロードしました"
else
  pm2 start ecosystem.config.js
  ok "PM2 でアプリを起動しました"
fi

# OS 起動時に PM2 を自動起動
pm2 save
pm2 startup | grep "sudo " | bash || true
ok "PM2 の自動起動を設定しました"

# ── Nginx 設定 ────────────────────────────────────────────────────────────────
step "Nginx を設定します..."

# ドメイン名を APP_URL から取り出す
DOMAIN=$(echo "$APP_URL" | sed -E 's|https?://||' | sed 's|/.*||')
if [[ "$DOMAIN" == "localhost"* ]] || [[ "$DOMAIN" =~ ^[0-9] ]]; then
  warn "ドメイン名が「${DOMAIN}」です。IPアドレスやlocalhostではHTTPS証明書を取得できません"
  USE_HTTPS=false
else
  USE_HTTPS=true
fi

NGINX_CONF="/etc/nginx/sites-available/webmail-app"

cat > "$NGINX_CONF" << NGINXEOF
# Shared Mail Workspace — Nginx 設定
# 生成日時: $(date '+%Y-%m-%d %H:%M:%S')

# HTTP → HTTPS リダイレクト (証明書取得後に有効)
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    # Let's Encrypt 認証用
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }

    # HTTPS にリダイレクト (証明書取得後にコメントを外す)
    # return 301 https://\$host\$request_uri;

    # 証明書取得前はHTTPで直接プロキシ
    location / {
        proxy_pass         http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        # SSE / IMAP Collab 向けバッファ無効化
        proxy_buffering    off;
        X-Accel-Buffering  no;
        client_max_body_size 50M;
    }
}

# HTTPS (証明書取得後に有効)
# server {
#     listen 443 ssl http2;
#     listen [::]:443 ssl http2;
#     server_name ${DOMAIN};
#
#     ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
#     ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
#     ssl_protocols       TLSv1.2 TLSv1.3;
#     ssl_ciphers         HIGH:!aNULL:!MD5;
#     ssl_session_cache   shared:SSL:10m;
#     ssl_session_timeout 10m;
#     add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
#
#     location / {
#         proxy_pass         http://127.0.0.1:${APP_PORT};
#         proxy_http_version 1.1;
#         proxy_set_header   Upgrade \$http_upgrade;
#         proxy_set_header   Connection 'upgrade';
#         proxy_set_header   Host \$host;
#         proxy_set_header   X-Real-IP \$remote_addr;
#         proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
#         proxy_set_header   X-Forwarded-Proto https;
#         proxy_cache_bypass \$http_upgrade;
#         proxy_read_timeout 86400s;
#         proxy_send_timeout 86400s;
#         proxy_buffering    off;
#         X-Accel-Buffering  no;
#         client_max_body_size 50M;
#     }
# }
NGINXEOF

# シンボリックリンク
if [[ ! -L /etc/nginx/sites-enabled/webmail-app ]]; then
  ln -s "$NGINX_CONF" /etc/nginx/sites-enabled/webmail-app
fi

# デフォルトサイトを無効化
[[ -L /etc/nginx/sites-enabled/default ]] && rm /etc/nginx/sites-enabled/default || true

# Nginx 設定テスト & リロード
nginx -t && systemctl reload nginx
ok "Nginx 設定を適用しました"

# ── HTTPS (Let's Encrypt) ─────────────────────────────────────────────────────
if [[ "$USE_HTTPS" == true ]] && certbot --version &>/dev/null; then
  step "HTTPS 証明書を設定します（Let's Encrypt）..."
  echo ""
  echo -e "  ドメイン: ${BOLD}${DOMAIN}${RESET}"
  read -rp "  certbot で HTTPS 証明書を取得しますか？ [Y/n]: " _https
  if [[ ! "$_https" =~ ^[nN]$ ]]; then
    mkdir -p /var/www/certbot
    certbot certonly --webroot -w /var/www/certbot \
      -d "$DOMAIN" \
      --email "$ADMIN_EMAIL" \
      --agree-tos --non-interactive \
      && {
        ok "証明書を取得しました"
        # Nginx 設定を HTTPS に切り替え
        sed -i 's|# return 301|return 301|' "$NGINX_CONF"
        sed -i 's|    # location /|    location /|' "$NGINX_CONF"
        # HTTPSブロックのコメントを外す
        python3 - <<'PYEOF'
import re, sys
with open('/etc/nginx/sites-available/webmail-app', 'r') as f:
    content = f.read()
# HTTPSブロックのコメントを外す (# server { ... # } → server { ... })
content = re.sub(r'^# (server \{)', r'\1', content, flags=re.MULTILINE)
content = re.sub(r'^# (    )', r'\1', content, flags=re.MULTILINE)
content = re.sub(r'^# (\})', r'\1', content, flags=re.MULTILINE)
with open('/etc/nginx/sites-available/webmail-app', 'w') as f:
    f.write(content)
PYEOF
        # HTTPブロックのプロキシをコメントアウト（リダイレクトのみ残す）
        nginx -t && systemctl reload nginx
        ok "Nginx を HTTPS モードに切り替えました"

        # 自動更新設定
        if ! crontab -l 2>/dev/null | grep -q certbot; then
          (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
          ok "certbot 自動更新 (毎日 AM3:00) を設定しました"
        fi
      } || {
        warn "証明書の取得に失敗しました。ドメインのDNSが正しく設定されているか確認してください"
        warn "後で手動で実行できます: certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}"
      }
  fi
fi

# ── 初期管理者ユーザー ────────────────────────────────────────────────────────
step "初期管理者ユーザーを作成しています..."
echo ""
read -rp "  初期管理者を作成しますか？ [Y/n]: " _seed
if [[ ! "$_seed" =~ ^[nN]$ ]]; then
  cd "$APP_DIR" && node prisma/seed.mjs && \
    ok "初期ユーザーを作成しました: admin@example.com / admin1234" || \
    warn "seed に失敗しました。後で手動で実行してください: node prisma/seed.mjs"
fi

# ── 完了メッセージ ────────────────────────────────────────────────────────────
hr
echo -e "\n${GREEN}${BOLD}  ✔ セットアップ完了！${RESET}\n"
echo -e "  アプリURL:        ${BOLD}${APP_URL}${RESET}"
echo -e "  PM2 ステータス:   pm2 status"
echo -e "  アプリログ:       pm2 logs webmail-app"
echo -e "  デプロイ更新:     bash ${APP_DIR}/scripts/deploy.sh"
echo ""
echo -e "  ${YELLOW}セットアップ後の手順:${RESET}"
echo "  1. ブラウザで ${APP_URL} にアクセス"
echo "  2. admin@example.com / admin1234 でログイン"
echo "  3. 管理画面 → 設定 → VAPID鍵を生成（PWA通知用）"
echo "  4. メールアカウントを追加"
if [[ "$USE_HTTPS" == true ]]; then
  echo -e "\n  ${YELLOW}HTTPS について:${RESET}"
  echo "  証明書が取得済みの場合、Nginx は HTTPS で動作しています"
  echo "  .env の NEXT_PUBLIC_APP_URL を https:// に変更して再デプロイしてください:"
  echo "  bash ${APP_DIR}/scripts/deploy.sh"
fi
echo ""
echo -e "  ${YELLOW}DB パスワード (安全な場所に保管):${RESET}"
echo "  ユーザー: ${DB_USER}"
echo "  DB:       ${DB_NAME}"
echo "  Pass:     ${DB_PASS}"
hr
