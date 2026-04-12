# 環境変数

> 最終更新: 2026-04-12  
> 参照元: `src/` 配下の全ファイルの `process.env.*` 参照箇所

---

## 概要

`.env.example` ファイルは確認されていない（**要追加**）。`CLAUDE.md` に記載の `.env` サンプルが設定ガイドの代替となっている。

全ての環境変数はサーバーサイド専用（Node.js runtime）。クライアントに公開される変数（`NEXT_PUBLIC_*`）は `NEXT_PUBLIC_APP_URL` のみ。

---

## 環境変数一覧

### 必須

| 変数名 | 必須 | 用途 | 使用ファイル | シークレット |
|---|---|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL接続文字列 | `prisma/schema.prisma` | ✅ |
| `SESSION_SECRET` | ✅ | iron-webcryptoのセッション暗号化鍵（32文字以上） | `src/lib/auth.ts` | ✅ |
| `ENCRYPTION_KEY_HEX` | ✅ | AES-256-GCM鍵（32バイト = 64桁の16進文字列） | `src/lib/crypto.ts` | ✅ |

### 任意（機能有効化に必要）

| 変数名 | 必須 | 用途 | 使用ファイル | シークレット |
|---|---|---|---|---|
| `VAPID_PUBLIC_KEY` | △ | Web Push VAPID公開鍵（管理画面でも生成可能） | `src/lib/push.ts` | いいえ |
| `VAPID_PRIVATE_KEY` | △ | Web Push VAPID秘密鍵（管理画面でも生成可能） | `src/lib/push.ts` | ✅ |
| `VAPID_SUBJECT` | △ | VAPID識別メールアドレス | `src/lib/push.ts` | いいえ |
| `MATTERMOST_BASE_URL` | △ | Mattermostサーバーベースurl（Bot連携用） | 未実装（stub） | いいえ |
| `MATTERMOST_BOT_TOKEN` | △ | Mattermost Bot APIトークン（Bot連携用） | 未実装（stub） | ✅ |
| `MATTERMOST_DEFAULT_CHANNEL_ID` | △ | Mattermost既定チャンネルID | 未実装（stub） | いいえ |
| `NEXT_PUBLIC_APP_URL` | △ | アプリのベースURL（Push通知URLの生成等） | 要確認 | いいえ |
| `CRON_SECRET` | △ | `/api/cron/sync` の認証トークン | `src/app/api/cron/sync/route.ts` | ✅ |
| `ENCRYPTION_KEY_VERSION` | △ | 暗号鍵バージョン識別子（例: `"v1"`） | `src/lib/crypto.ts`（推定） | いいえ |
| `GOOGLE_CLIENT_ID` | △ | Google OAuth クライアントID（コンタクト同期用） | `src/app/api/contacts/google/auth/route.ts`, `sync/route.ts`, `callback/route.ts` | ✅ |
| `GOOGLE_CLIENT_SECRET` | △ | Google OAuth クライアントシークレット（コンタクト同期用） | `src/app/api/contacts/google/sync/route.ts`, `callback/route.ts` | ✅ |

> **注意**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` は環境変数に設定しなくても、管理画面（`/admin/settings`）から生成・保存できる。保存先は `app_settings` テーブル。

---

## 各変数の詳細

### `DATABASE_URL`

```env
DATABASE_URL="postgresql://user@localhost:5432/webmail_app?schema=public"
```

- PostgreSQL 接続文字列。Prisma の `datasource db { url = env("DATABASE_URL") }` で参照。
- 開発環境: ローカルPostgreSQL（デフォルトユーザー `ddd3h`）
- 本番環境: PostgreSQL 16以上が必要

---

### `SESSION_SECRET`

```env
SESSION_SECRET="ランダムな32文字以上の文字列"
```

- iron-webcrypto の sealed session に使用するパスワード。
- `src/lib/auth.ts` の先頭で `const secretRaw = process.env.SESSION_SECRET || 'dev-secret-at-least-32-chars-long!!'` として参照。
- **未設定時はデフォルト値が使用される（開発環境専用）。本番環境では必ず強力なランダム文字列を設定すること。**

---

### `ENCRYPTION_KEY_HEX`

```env
ENCRYPTION_KEY_HEX="0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
```

- AES-256-GCM の256ビット（32バイト）鍵を16進数64文字で表現。
- `src/lib/crypto.ts` で参照。IMAPパスワード・SMTPパスワード・Google OAuthトークンの暗号化に使用。
- **変更するとDB内の全暗号化データが復号不能になる。絶対に変更しないこと（鍵ローテーション手順は未実装）。**

生成コマンド例:
```bash
openssl rand -hex 32
```

---

### `ENCRYPTION_KEY_VERSION`

```env
ENCRYPTION_KEY_VERSION="v1"
```

- `mailbox_credentials.encryption_key_version` カラムに保存される鍵バージョン識別子。
- 将来的な鍵ローテーション対応用。現在は `"v1"` 固定で運用。

---

### `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`

```env
VAPID_PUBLIC_KEY="BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxD_g"
VAPID_PRIVATE_KEY="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
VAPID_SUBJECT="mailto:admin@example.com"
```

- Web Push通知に使用。設定しない場合は管理画面から生成・DBに保存する方式でも動作する。
- `src/lib/push.ts` の `ensureWebPushConfigured()` で `app_settings` テーブルから取得して設定。
- 環境変数が設定されている場合の読み込み箇所: **要確認**（`app_settings` テーブル優先か環境変数優先かは要確認）

---

### `CRON_SECRET`

```env
CRON_SECRET="your-strong-cron-secret"
```

- `GET /api/cron/sync` エンドポイントの認証に使用。
- 設定した場合: `Authorization: Bearer <CRON_SECRET>` ヘッダーが必要。
- 未設定の場合: 全リクエストを許可。**本番環境では必ず設定すること。**

Vercel Crons の場合は `vercel.json` で:
```json
{
  "crons": [{ "path": "/api/cron/sync", "schedule": "*/5 * * * *" }]
}
```

---

### `NEXT_PUBLIC_APP_URL`

```env
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

- アプリのベースURL。`NEXT_PUBLIC_` プレフィックスによりクライアントコードでも参照可能。
- **WebAuthn Relying Party ID** として使用（`src/lib/passkey-rp.ts`）。本番URLを正確に設定しないとパスキー認証が機能しない。
- パスワードリセットリンクのベースURL（`src/app/api/profile/password-reset-request/route.ts`）
- Google OAuthコールバックURL（`src/app/api/contacts/google/auth/route.ts`）
- アバターリダイレクトURL（`src/app/api/user/avatar/route.ts`）

---

### `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

```env
GOOGLE_CLIENT_ID="xxxxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxx"
```

- Google Contacts APIとの連携（`/contacts/google/*`）に必要。
- Google Cloud Console でOAuthクライアントを作成して取得する。
- リダイレクトURIに `{NEXT_PUBLIC_APP_URL}/api/contacts/google/callback` を設定すること。
- 未設定の場合、Google連携機能は動作しない（コンタクトの手動管理は引き続き可能）。

---

## .env ファイルの管理

`.env.example` ファイルが存在しない。新メンバーのオンボーディング時のため、以下のファイルを作成することを推奨:

```bash
# .env.example
DATABASE_URL="postgresql://user@localhost:5432/webmail_app?schema=public"
SESSION_SECRET=""  # openssl rand -base64 32 で生成
ENCRYPTION_KEY_HEX=""  # openssl rand -hex 32 で生成
ENCRYPTION_KEY_VERSION="v1"
VAPID_PUBLIC_KEY=""  # 管理画面から生成可能
VAPID_PRIVATE_KEY=""  # 管理画面から生成可能
VAPID_SUBJECT="mailto:admin@example.com"
MATTERMOST_BASE_URL=""
MATTERMOST_BOT_TOKEN=""
MATTERMOST_DEFAULT_CHANNEL_ID=""
NEXT_PUBLIC_APP_URL="http://localhost:3000"
CRON_SECRET=""  # 本番環境では必ず設定
GOOGLE_CLIENT_ID=""  # Google Contactsとの連携に必要
GOOGLE_CLIENT_SECRET=""  # Google Contactsとの連携に必要
```

---

## 開発環境と本番環境の違い

| 変数 | 開発環境 | 本番環境 |
|---|---|---|
| `DATABASE_URL` | ローカルPostgreSQL | クラウドDBまたはVPS PostgreSQL |
| `SESSION_SECRET` | デフォルト値でも動作（非推奨） | 必ず強力なランダム文字列 |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | `https://your-domain.com` |
| `CRON_SECRET` | 未設定でも可 | 必ず設定 |
| Cookie `secure` | false（HTTP） | **true（HTTPS）— コード修正が必要** |

---

## 更新時チェック項目

- 新規環境変数を追加した場合は本ドキュメントの一覧テーブルに追記すること
- `.env.example` ファイルを作成したら「.envファイルの管理」節を更新すること
- セキュリティ要件が変わった場合は「開発環境と本番環境の違い」表を更新すること
