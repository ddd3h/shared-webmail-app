#!/usr/bin/env bash
# Add the /collab/ location to this server's nginx site, so the browsers reach the collaboration server:
# wss://<domain>/collab/webmail-draft-<id> → http://127.0.0.1:1234/webmail-draft-<id> (the server inside the app, src/lib/collab/embedded.ts).
# Without it, shared drafts are still saved and merged, but people do not see each other's typing live.
#
#   sudo bash nginx-add-collab.sh              add it, check the configuration (nginx -t) and reload nginx
#   bash nginx-add-collab.sh --dry-run         only show what would change (no sudo needed)
#   sudo bash nginx-add-collab.sh <site file>  another site file (default: /etc/nginx/sites-enabled/shared-webmail-app)
#
# Safe to run again: when the location is there, nothing changes. The file is backed up first (<file>.bak-<date>), and if the new
# configuration does not pass `nginx -t`, the backup is put back and nginx is not reloaded.
# The block is the same as deploy/nginx-collab.conf. It goes into the server block that listens on 443, before its `location /`.
set -euo pipefail

DRY_RUN=false
SITE=/etc/nginx/sites-enabled/shared-webmail-app
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) SITE="$arg" ;;
  esac
done
COLLAB_PORT="${COLLAB_PORT:-1234}"

ok()   { echo -e "\033[0;32m✔\033[0m  $*"; }
fail() { echo -e "\033[0;31m✘\033[0m  $*" >&2; exit 1; }

CONF="$(readlink -f "$SITE")"
[[ -f "$CONF" ]] || fail "nginx の設定ファイルがありません: $SITE"

if grep -qE '^[[:space:]]*location[[:space:]]+/collab/' "$CONF"; then
  ok "すでに location /collab/ があります（$CONF）。何も変えません。"
  exit 0
fi

NEW="$(mktemp)"
trap 'rm -f "$NEW"' EXIT

# Find the server block that listens on 443 (braces counted, comments ignored) and put the location before its `location /`.
python3 - "$CONF" "$NEW" "$COLLAB_PORT" <<'PY'
import re, sys
src, dst, port = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(src).read().split('\n')
code = lambda l: l.split('#', 1)[0]

blocks, depth, start = [], 0, None
for i, l in enumerate(lines):
    c = code(l)
    if depth == 0 and re.match(r'\s*server\s*\{', c):
        start = i
    depth += c.count('{') - c.count('}')
    if start is not None and depth == 0:
        blocks.append((start, i))
        start = None

target = next(((s, e) for s, e in blocks if any(re.match(r'\s*listen\s+[^;]*\b443\b', code(l)) for l in lines[s:e + 1])), None)
if not target:
    sys.exit('443 で待ち受ける server ブロックが見つかりません')
s, e = target
at = next((i for i in range(s, e + 1) if re.match(r'\s*location\s+/\s*\{', code(lines[i]))), None)
if at is None:
    sys.exit('443 の server ブロックに location / がありません')

pad = re.match(r'(\s*)', lines[at]).group(1) or '    '
block = [
    '# Live co-editing of shared drafts: the collaboration server inside the app (127.0.0.1 only). Added by deploy/nginx-add-collab.sh.',
    '# The trailing slash of proxy_pass strips /collab/, so the server sees the room name "webmail-draft-<id>".',
    'location /collab/ {',
    f'    proxy_pass http://127.0.0.1:{port}/;',
    '    proxy_http_version 1.1;',
    '    proxy_set_header Upgrade $http_upgrade;',
    '    proxy_set_header Connection "upgrade";',
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Real-IP $remote_addr;',
    '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $scheme;',
    '',
    "    # WebSocket connections are long-lived; don't time them out.",
    '    proxy_read_timeout 86400s;',
    '    proxy_send_timeout 86400s;',
    '}',
    '',
]
lines[at:at] = [pad + b if b else '' for b in block]
open(dst, 'w').write('\n'.join(lines))
PY

if $DRY_RUN; then
  echo "変更内容（$CONF）:"
  diff -u "$CONF" "$NEW" || true
  echo
  ok "--dry-run なので、ファイルは変えていません。反映するには: sudo bash $0"
  exit 0
fi

[[ $EUID -eq 0 ]] || fail "sudo で実行してください: sudo bash $0"

BACKUP="$CONF.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$CONF" "$BACKUP"
ok "元の設定を残しました: $BACKUP"
cat "$NEW" > "$CONF"   # keeps the file's owner and permissions

if ! nginx -t; then
  cp -p "$BACKUP" "$CONF"
  fail "新しい設定が nginx -t を通らなかったので、元に戻しました（nginx は再読み込みしていません）"
fi
systemctl reload nginx
ok "nginx を再読み込みしました"

# Check without sending anything through the app (its bot guard would take a script for a robot): the location is loaded, and the
# collaboration server answers on its own port.
if nginx -T 2>/dev/null | grep -qE '^[[:space:]]*location[[:space:]]+/collab/'; then
  ok "nginx に location /collab/ が入りました"
else
  fail "nginx -T に location /collab/ が見当たりません。設定ファイルを確かめてください: $CONF"
fi
if [[ "$(curl -s --max-time 5 "http://127.0.0.1:${COLLAB_PORT}/" || true)" == "collab server ok" ]]; then
  ok "共同編集サーバーが 127.0.0.1:${COLLAB_PORT} で応答しています"
else
  echo "⚠  共同編集サーバーが 127.0.0.1:${COLLAB_PORT} で応答しません。アプリが動いているか（pm2 status）確かめてください" >&2
fi
echo
ok "完了。共有メールの下書きを2人で開くと、相手の入力がそのまま見えるようになります"
