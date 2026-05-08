#!/usr/bin/env bash
# =============================================================================
#  Shared Mail Workspace — デプロイ・更新スクリプト
#
#  使い方:
#    bash scripts/deploy.sh           # カレントブランチのまま更新
#    bash scripts/deploy.sh main      # 指定ブランチに切り替えて更新
# =============================================================================

set -euo pipefail

# ── カラー定義 ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${BLUE}ℹ${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✘${RESET}  $*"; exit 1; }
step() { echo -e "\n${BOLD}${CYAN}▸ $*${RESET}"; }
hr()   { echo -e "${CYAN}$(printf '─%.0s' {1..60})${RESET}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BRANCH="${1:-}"

hr
echo -e "${BOLD}  Shared Mail Workspace — デプロイ${RESET}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
hr

cd "$APP_DIR"

# .env が存在しない場合はセットアップを促す
if [[ ! -f .env ]]; then
  err ".env が見つかりません。先に production-setup.sh を実行してください"
fi

# ── git pull ─────────────────────────────────────────────────────────────────
step "コードを更新しています..."

if git remote -v 2>/dev/null | grep -q origin; then
  if [[ -n "$BRANCH" ]]; then
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
    ok "ブランチ「${BRANCH}」に切り替えて pull しました"
  else
    CURRENT_BRANCH=$(git branch --show-current)
    git pull origin "$CURRENT_BRANCH" 2>&1 || {
      warn "git pull に失敗しました（リモートなし、またはローカル変更あり）。スキップします"
    }
    ok "ブランチ「${CURRENT_BRANCH}」を更新しました"
  fi
else
  warn "git リモートが見つかりません。コード更新をスキップします"
fi

# ── 依存パッケージ ────────────────────────────────────────────────────────────
step "npm パッケージを確認しています..."
if [[ package.json -nt node_modules/.install_stamp ]] 2>/dev/null || [[ ! -d node_modules ]]; then
  npm ci --prefer-offline 2>&1 | tail -3 || npm install
  touch node_modules/.install_stamp
  ok "npm install 完了"
else
  ok "パッケージは最新です（スキップ）"
fi

# ── Prisma ────────────────────────────────────────────────────────────────────
step "Prisma クライアントを生成しています..."
npx prisma generate
ok "prisma generate 完了"

step "データベースマイグレーションを実行しています..."
npx prisma migrate deploy 2>&1 && ok "マイグレーション完了" || {
  warn "マイグレーションに失敗しました。DBの状態を確認してください"
  warn "手動実行: npx prisma migrate deploy"
}

# ── ビルド ────────────────────────────────────────────────────────────────────
step "アプリケーションをビルドしています..."
START_TIME=$(date +%s)
npm run build
END_TIME=$(date +%s)
ok "ビルド完了 ($(( END_TIME - START_TIME ))秒)"

# standalone モードのスタティックファイルをコピー
if [[ -d ".next/standalone" ]]; then
  cp -r public .next/standalone/ 2>/dev/null || true
  cp -r .next/static .next/standalone/.next/static 2>/dev/null || true
  ok "standalone ファイルをコピーしました"
fi

# ── PM2 再起動 ────────────────────────────────────────────────────────────────
step "アプリケーションを再起動しています..."

if pm2 describe shared-webmail-app &>/dev/null; then
  if [[ -f ecosystem.config.js ]]; then
    pm2 reload ecosystem.config.js --update-env
    ok "PM2 プロセスをリロードしました（ダウンタイムなし）"
  else
    pm2 restart shared-webmail-app
    ok "PM2 プロセスを再起動しました"
  fi
else
  if [[ -f ecosystem.config.js ]]; then
    pm2 start ecosystem.config.js
    ok "PM2 でアプリを起動しました"
  else
    err "ecosystem.config.js が見つかりません。production-setup.sh を先に実行してください"
  fi
fi

pm2 save

# ── 完了 ─────────────────────────────────────────────────────────────────────
hr
echo -e "${GREEN}${BOLD}  ✔ デプロイ完了！${RESET}"
echo ""
pm2 list | grep shared-webmail-app || true
echo ""
echo -e "  ログ確認: ${BOLD}pm2 logs shared-webmail-app --lines 50${RESET}"
hr
