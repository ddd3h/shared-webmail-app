# セットアップ・起動・デプロイ

> 最終更新: 2026-04-12

---

## 前提ツール

| ツール | バージョン | 備考 |
|---|---|---|
| Node.js | 20以上（推奨） | `package.json` の `@types/node: ^20.12.7` より |
| PostgreSQL | 16 | `prisma/schema.prisma` で `postgresql` 指定 |
| npm | 付属のものを使用 | yarn / pnpm は未確認 |
| ts-node | ^10.9.2 | Worker起動に必要（devDependencies） |

---

## ローカル開発セットアップ手順

### 1. リポジトリのクローン・依存関係インストール

```bash
cd webmail-app
npm install
```

### 2. PostgreSQL を起動

```bash
# Homebrew（macOS）の場合
brew services start postgresql@16

# または直接起動
pg_ctl start
```

### 3. データベース作成

```bash
createdb webmail_app
```

### 4. 環境変数の設定

```bash
cp .env.example .env  # .env.example が存在しない場合は手動作成
```

`.env` に以下を設定（[10_environment_variables.md](./10_environment_variables.md) 参照）:

```env
DATABASE_URL="postgresql://your_user@localhost:5432/webmail_app?schema=public"
SESSION_SECRET="ランダムな32文字以上の文字列"
ENCRYPTION_KEY_HEX="64桁の16進文字列"
ENCRYPTION_KEY_VERSION="v1"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

鍵の生成:
```bash
# SESSION_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY_HEX
openssl rand -hex 32
```

### 5. DBマイグレーション実行

```bash
npx prisma migrate dev
```

### 6. 初期データ投入（管理者ユーザー作成）

```bash
node prisma/seed.mjs
# → admin@example.com / admin1234 が作成される
```

### 7. 開発サーバー起動

```bash
npm run dev
# → http://localhost:3000 でアクセス可能
```

### 8. 動作確認

1. `http://localhost:3000` にアクセス
2. `admin@example.com` / `admin1234` でログイン
3. `/admin/settings` からメールアカウントを設定
4. 接続テストを実行
5. 手動同期を実行してメールを取得

---

## npm スクリプト一覧

| スクリプト | コマンド | 説明 |
|---|---|---|
| 開発サーバー | `npm run dev` | Hot reload付き開発サーバー |
| 本番ビルド | `npm run build` | Next.jsの本番ビルド |
| 本番起動 | `npm run start` | ビルド済みアプリを起動 |
| IMAP同期Worker | `npm run worker:sync` | IMAP同期バックグラウンドプロセス |
| SMTP送信Worker | `npm run worker:send` | SMTP送信バックグラウンドプロセス |
| Mattermostスタブ | `npm run worker:mattermost` | スタブ（未実装） |
| Pushスタブ | `npm run worker:push` | スタブ（未実装） |
| テスト | `npm run test` | Vitest（1回実行） |
| テスト監視 | `npm run test:watch` | Vitest（ウォッチモード） |
| Prisma generate | `npm run prisma:generate` | Prismaクライアント再生成 |
| Prisma migrate | `npm run prisma:migrate` | DBマイグレーション（dev） |

---

## 本番ビルド・起動

```bash
# 1. ビルド
npm run build

# 2. 起動
npm run start
```

本番環境では以下も別途起動が必要:
```bash
# IMAP同期（バックグラウンド）
npm run worker:sync &

# SMTP送信（バックグラウンド）
npm run worker:send &
```

> **注意**: `src/instrumentation.node.ts` により、Next.jsサーバー起動時にもIMAPバックグラウンドループが起動する。Worker と重複するため、本番では Worker を使い instrumentation 側を無効化することを検討すること。

---

## Cronジョブ設定

定期同期を外部Cronで行う場合:

```bash
# crontab（5分おき）
*/5 * * * * curl -H "Authorization: Bearer your-secret" http://localhost:3000/api/cron/sync
```

Vercel の場合（`vercel.json`）:
```json
{
  "crons": [{ "path": "/api/cron/sync", "schedule": "*/5 * * * *" }]
}
```

---

## Docker / Compose

**現時点ではDocker/docker-compose.ymlが存在しない**（コード上で確認不可）。コンテナ化が必要な場合は以下を参考に作成すること:

- Node.js 20ベースのイメージ
- PostgreSQL 16コンテナ
- `storage/attachments/` をボリュームマウント
- 環境変数はシークレット管理ツールから注入

---

## DBスキーマ変更時の手順

```bash
# 1. prisma/schema.prisma を編集

# 2. migrationを作成・適用
npx prisma migrate dev --name <変更名>

# 3. Prismaクライアントを再生成
npx prisma generate

# 4. 開発サーバーを再起動（古いクライアントがメモリキャッシュされるため）
```

本番環境での migration:
```bash
npx prisma migrate deploy  # productionではdevではなくdeployを使用
```

---

## よくある起動失敗ポイント

### PostgreSQL接続エラー

```
PrismaClientInitializationError: Can't reach database server
```

→ `brew services start postgresql@16` でPostgreSQLを起動する。`DATABASE_URL` のユーザー名・DB名を確認する。

### Prismaクライアントが古い

```
Unknown field 'xxx' in select
```

→ `npx prisma generate` を実行してから開発サーバーを再起動する。

### セッションが機能しない

→ `SESSION_SECRET` が設定されているか確認する。

### メールパスワード復号エラー

```
ENCRYPTION_KEY_HEX must be 32 bytes hex
```

→ `ENCRYPTION_KEY_HEX` が64桁の16進文字列（`openssl rand -hex 32` で生成）であることを確認する。

### Push通知が届かない

→ `app_settings` テーブルに VAPID鍵が設定されているか確認する。管理画面から生成・保存すること。

---

## 更新時チェック項目

- Node.js や PostgreSQL のバージョン要件が変わった場合は「前提ツール」テーブルを更新すること
- スクリプトが追加された場合は `npm スクリプト一覧` テーブルを更新すること
- Docker 設定が追加された場合は「Docker/Compose」節を更新すること
