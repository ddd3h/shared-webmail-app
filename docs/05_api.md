# API仕様

> 最終更新: 2026-04-12  
> 実装ファイル基準: `src/app/api/` 配下の全 `route.ts`（62ファイル）

---

## API全体概要

- **ベースURL**: `/api/`（Next.js Route Handlers）
- **認証**: `Cookie: sid` に iron-sealed session トークンを保持。全エンドポイントで `getSession()` + `requireAuth()` を実行（公開パスを除く）
- **コンテンツタイプ**: リクエスト/レスポンスともに `application/json`（ファイルアップロードは `multipart/form-data`）
- **エラー形式**: `{ "error": "<エラーコード>" }` + HTTPステータスコード

### 公開パス（認証不要）

`src/middleware.ts` の `PUBLIC_PATHS` より:
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET|POST /api/cron/*`（CRON_SECRET対応可）
- `POST /api/passkeys/auth-options`
- `POST /api/passkeys/auth`

### 管理者専用パス

`/api/admin/*` は middleware で `session.role === 'admin'` チェックあり。

---

## エンドポイント一覧

| Method | Path | 役割 | 認証 | 管理者のみ |
|---|---|---|---|---|
| POST | `/api/auth/login` | パスワードログイン | 不要 | — |
| POST | `/api/auth/logout` | ログアウト | 不要 | — |
| GET | `/api/auth/session` | セッション確認 | 必要 | — |
| GET | `/api/passkeys/register-options` | Passkey登録チャレンジ取得 | 必要 | — |
| POST | `/api/passkeys/register` | Passkey登録 | 必要 | — |
| POST | `/api/passkeys/auth-options` | Passkey認証チャレンジ取得 | 不要 | — |
| POST | `/api/passkeys/auth` | Passkey認証 | 不要 | — |
| GET | `/api/passkeys` | 自分のPasskey一覧 | 必要 | — |
| GET | `/api/passkeys/[id]` | Passkey詳細 | 必要 | — |
| DELETE | `/api/passkeys/[id]` | Passkey削除 | 必要 | — |
| POST | `/api/profile/password` | パスワード変更 | 必要 | — |
| POST | `/api/profile/password-reset-request` | パスワードリセット要求 | 不要（推定） | — |
| POST | `/api/profile/password-reset` | パスワードリセット実行 | 不要（推定） | — |
| GET | `/api/users` | ユーザー一覧 | 必要 | — |
| POST | `/api/users` | ユーザー作成 | 必要 | ✅ |
| GET | `/api/users/[id]` | ユーザー詳細 | 必要 | — |
| PUT | `/api/users/[id]` | ユーザー更新（名前、メール、権限、PW、Mattermost連携） | 必要 | ✅ |
| GET | `/api/users/[id]/avatar` | アバター取得 | 必要（推定） | — |
| POST | `/api/user/signature` | 署名更新（自分） | 必要 | — |
| POST | `/api/user/avatar` | アバター更新（自分） | 必要 | — |
| POST | `/api/user/storage-recalc` | 容量再計算 | 必要 | — |
| GET | `/api/mailboxes` | メールボックス一覧 | 必要 | — |
| POST | `/api/mailboxes` | メールボックス作成 | 必要 | ✅（teamのみ） |
| GET | `/api/mailboxes/[id]` | メールボックス詳細 | 必要 | — |
| PUT | `/api/mailboxes/[id]` | メールボックス更新 | 必要 | — |
| DELETE | `/api/mailboxes/[id]` | メールボックス削除 | 必要 | — |
| POST | `/api/mailboxes/[id]/test` | IMAP/SMTP接続テスト | 必要 | — |
| POST | `/api/mailboxes/[id]/resync` | 手動同期トリガー | 必要 | — |
| PUT | `/api/mailboxes/[id]/permissions` | 権限保存 | 必要 | — |
| GET | `/api/mailboxes/[id]/permissions/list` | 権限一覧 | 必要 | — |
| GET | `/api/threads` | スレッド一覧 | 必要 | — |
| GET | `/api/threads/[id]` | スレッド詳細 | 必要 | — |
| POST | `/api/threads/[id]/assign` | 担当変更 | 必要 | — |
| POST | `/api/threads/[id]/status` | ステータス変更 | 必要 | — |
| POST | `/api/threads/[id]/read` | 既読にする | 必要 | — |
| POST | `/api/threads/[id]/unread` | 未読にする | 必要 | — |
| POST | `/api/threads/[id]/hide` | 非表示 | 必要 | — |
| POST | `/api/threads/[id]/archive` | アーカイブ | 必要 | — |
| POST | `/api/threads/[id]/delete` | 削除 | 必要 | — |
| POST | `/api/threads/[id]/move` | メールボックス移動 | 必要 | — |
| POST | `/api/threads/[id]/mattermost/discuss` | Mattermost議論作成 | 必要 | — |
| POST | `/api/threads/[id]/mattermost/forward` | Mattermostに転送 | 必要 | — |
| POST | `/api/threads/[id]/mattermost/link` | Mattermostリンク作成 | 必要 | — |
| POST | `/api/messages/compose` | 新規メール送信 | 必要 | — |
| POST | `/api/messages/[id]/reply` | 返信送信 | 必要 | — |
| GET | `/api/messages/[id]/attachment/[attId]` | 添付ファイルダウンロード | 必要 | — |
| GET | `/api/drafts` | 下書き一覧 | 必要 | — |
| POST | `/api/drafts` | 下書き作成 | 必要 | — |
| GET | `/api/drafts/[id]` | 下書き取得 | 必要 | — |
| PUT | `/api/drafts/[id]` | 下書き更新 | 必要 | — |
| DELETE | `/api/drafts/[id]` | 下書き削除 | 必要 | — |
| GET | `/api/contacts` | コンタクト一覧/検索 | 必要 | — |
| POST | `/api/contacts` | コンタクト作成 | 必要 | — |
| GET | `/api/contacts/[id]` | コンタクト詳細 | 必要 | — |
| PUT | `/api/contacts/[id]` | コンタクト更新 | 必要 | — |
| DELETE | `/api/contacts/[id]` | コンタクト削除 | 必要 | — |
| GET | `/api/contacts/google/auth` | Google OAuth開始 | 必要 | — |
| GET | `/api/contacts/google/callback` | Google OAuthコールバック | 不要（推定） | — |
| POST | `/api/contacts/google/sync` | Google連絡先同期 | 必要 | — |
| POST | `/api/push/subscribe` | Push購読登録 | 必要 | — |
| GET | `/api/push/vapid-public-key` | VAPID公開鍵取得 | 不要（推定） | — |
| POST | `/api/push/test` | テスト通知送信 | 必要 | — |
| GET | `/api/push/devices` | デバイス一覧 | 必要 | — |
| DELETE | `/api/push/devices/[id]` | デバイス削除 | 必要 | — |
| GET | `/api/dashboard` | ダッシュボードデータ | 必要 | — |
| GET | `/api/admin/settings` | システム設定取得 | 必要 | ✅ |
| PUT | `/api/admin/settings` | システム設定更新 | 必要 | ✅ |
| POST | `/api/admin/settings/generate-vapid` | VAPID鍵生成 | 必要 | ✅ |
| GET | `/api/admin/settings/vapid-public-key` | VAPID公開鍵（管理用） | 必要 | ✅ |
| GET | `/api/admin/audit-logs` | 監査ログ取得 | 必要 | ✅ |
| GET | `/api/admin/connection-errors` | 接続エラー一覧 | 必要 | ✅ |
| GET | `/api/admin/notification-errors` | 通知エラー一覧 | 必要 | ✅ |
| POST | `/api/admin/notification-errors/[id]/retry` | 通知再試行 | 必要 | ✅ |
| GET | `/api/admin/users` | ユーザー管理（管理者用） | 必要 | ✅ |
| GET | `/api/cron/sync` | 全メールボックス同期 | 不要（CRON_SECRET任意） | — |

---

## 主要エンドポイント詳細

### `POST /api/auth/login`

**ファイル**: `src/app/api/auth/login/route.ts`

**リクエストボディ**:
```json
{ "email": "user@example.com", "password": "password123" }
```

**レスポンス（成功）**: `{ "ok": true }` + `Set-Cookie: sid=<sealed-token>`

**エラー**:
- `{ "error": "unauthorized" }` (401) — 認証失敗

---

### `GET /api/auth/session`

**ファイル**: `src/app/api/auth/session/route.ts`

**レスポンス（成功）**:
```json
{ "userId": "cuid...", "email": "user@example.com", "role": "user" }
```

---

### `PUT /api/users/[id]`

**管理者専用**

**リクエストボディ**:
```json
{
  "name": "新しい名前",
  "email": "new@example.com",
  "role": "admin",
  "password": "newpassword123",
  "mattermost_user_id": "s6ftom3jypgcuq7him9knzfo1a"
}
```
※ 全てのフィールドは省略可能。`mattermost_user_id` に `null` を指定すると削除。

**エラー**:
- `email_already_exists` (400) - 指定されたメールアドレスが既に使用されている
- `bad_request` (400) - 入力バリデーションエラー

---

### `GET /api/threads`

**ファイル**: `src/app/api/threads/route.ts`

**クエリパラメータ**:
| パラメータ | 型 | 説明 |
|---|---|---|
| `status` | string | `open`, `in_progress`, `waiting`, `done`, `archived` |
| `type` | string | `personal`, `team` |
| `q` | string | フリーテキスト検索（`from:`, `to:`, `subject:`, `has:attachment`, `after:`, `before:` プレフィックス対応） |
| `mine` | `'1'` | 自分が担当のもののみ |
| `unread` | `'1'` | 未読のみ（クライアントサイドフィルタ） |

**レスポンス**:
```json
{
  "items": [
    {
      "id": "cuid...",
      "subject": "件名",
      "status": "open",
      "unread_count": 2,
      "last_message_at": "2026-04-12T00:00:00.000Z",
      "mailbox": { "id": "...", "name": "共有メール", "type": "team" },
      "assigned_user": { "id": "...", "name": "担当者名" }
    }
  ]
}
```

---

### `GET /api/threads/[id]`

**ファイル**: `src/app/api/threads/[id]/route.ts`

**レスポンス**:
```json
{
  "id": "cuid...",
  "subject": "件名",
  "status": "open",
  "permissions": {
    "can_view": true,
    "can_reply": false,
    "can_assign": false
  },
  "mailbox": {
    "id": "...",
    "name": "ロケット開発部門",
    "type": "team",
    "mattermost_channel_id": null
  },
  "assigned_user": { "id": "...", "name": "担当者名" },
  "last_replied_by": null,
  "mattermost": null,
  "messages": [
    {
      "id": "...",
      "direction": "incoming",
      "from": { "name": "送信者", "email": "sender@example.com" },
      "to": "recipient@example.com",
      "cc": null,
      "subject": "件名",
      "sent_at": "2026-04-12T00:00:00.000Z",
      "received_at": "2026-04-12T00:00:00.000Z",
      "text_body": "本文テキスト",
      "html_body": "<p>本文HTML</p>",
      "has_attachments": false,
      "attachments": []
    }
  ]
}
```

**権限チェック**:
- 管理者・メールボックスオーナーは常にフル権限
- チームメールボックスの非管理者・非オーナーは `mailbox_permissions` テーブルの値を返す
- 個人メールボックスは常にフル権限を返す（UI表示用）

---

### `POST /api/threads/[id]/assign`

**ファイル**: `src/app/api/threads/[id]/assign/route.ts`

**リクエストボディ**:
```json
{ "user_id": "cuid..." }
```
または担当解除:
```json
{ "user_id": null }
```

**認可**: 管理者・オーナーは常に可。それ以外は `mailbox_permissions.can_assign = true` が必要。

**副作用**:
- スレッドステータスを `in_progress`（担当あり）または `open`（担当なし）に変更
- `thread_assignments` にレコード作成
- Push通知・Mattermost通知をキューに追加

---

### `POST /api/messages/[id]/reply`

**ファイル**: `src/app/api/messages/[id]/reply/route.ts`

**認可**: `canReplyMailbox()` (`src/lib/rbac.ts`) — 管理者・オーナーは常に可。それ以外は `can_reply = true` が必要。

**リクエスト**: `multipart/form-data` または `application/json`

| フィールド | 型 | 説明 |
|---|---|---|
| `to` | string[] (JSON) | 宛先（省略時は元メールのfromアドレス） |
| `cc` | string[] (JSON) | CC |
| `bcc` | string[] (JSON) | BCC |
| `subject` | string | 件名（省略時は `Re: {元件名}`） |
| `text` | string | テキスト本文 |
| `html` | string | HTML本文 |
| `file` | File[] | 添付ファイル（複数可） |

**レスポンス**: `{ "ok": true, "message_id": "..." }`

**副作用**:
- `messages` テーブルにレコード作成
- `message_sends` テーブルにジョブを `pending` でキュー
- `threads.last_sent_at`, `last_replied_by_user_id` を更新
- `sendMailForMessage()` を fire-and-forget で呼び出し

---

### `PUT /api/mailboxes/[id]/permissions`

**ファイル**: `src/app/api/mailboxes/[id]/permissions/route.ts`

**リクエストボディ**:
```json
{
  "items": [
    { "user_id": "cuid...", "can_view": true, "can_reply": false, "can_assign": false }
  ]
}
```

**認可**: 管理者または当該メールボックスのオーナー。

**動作**: 各ユーザーに対して `mailbox_permissions` を `upsert`（既存レコードは更新、なければ作成）。

---

### `GET /api/mailboxes`

**ファイル**: `src/app/api/mailboxes/route.ts`

**クエリパラメータ**:
| パラメータ | 型 | 説明 |
|---|---|---|
| `mine` | `'1'` | 管理者でも自分のアクセス可能なもののみ返す |

**レスポンス**: `{ "items": [...] }` — `permissions` 配列を含む

---

### `POST /api/push/subscribe`

**ファイル**: `src/app/api/push/subscribe/route.ts`

**リクエストボディ**:
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": { "p256dh": "...", "auth": "..." },
  "platform": "chrome",
  "userAgent": "Mozilla/5.0 ..."
}
```

**動作**: `push_subscriptions` テーブルに `upsert`（endpoint キーで一意）。

---

### `GET /api/cron/sync`

**ファイル**: `src/app/api/cron/sync/route.ts`

**認証**: `Authorization: Bearer <CRON_SECRET>` が設定されている場合は検証。未設定の場合は全リクエストを許可。

**動作**: 全アクティブメールボックスの同期を起動。

---

### `GET /api/dashboard`

**ファイル**: `src/app/api/dashboard/route.ts`

**レスポンス**（コードから推定、詳細は要確認）:
```json
{
  "assigned_count": 3,
  "in_progress_count": 1,
  "recent_threads": [...],
  "mailbox_storage": [
    {
      "id": "...",
      "name": "個人メール",
      "cached_size_bytes": 102400,
      "cached_at": "2026-04-12T00:00:00.000Z"
    }
  ]
}
```

---

## ファイルアップロード

添付ファイルのアップロードは `POST /api/messages/[id]/reply` と `POST /api/messages/compose` で `multipart/form-data` として受け付ける。

ファイルは `storage/attachments/{uuid}{ext}` に保存され、`attachments` テーブルに `storage_key` として記録される。

ダウンロードは `GET /api/messages/[id]/attachment/[attId]` で提供。

---

## レート制限

**コード上での実装は確認できない**（要確認）。Vercel等のプラットフォームレベルのレート制限に依存している可能性あり。

---

## ページネーション

スレッド一覧（`GET /api/threads`）では `take` パラメータによる件数制限が内部的に実装されているが（未読時500件、通常200件）、クライアントからのページネーションパラメータは提供されていない（要確認）。

---

## 更新時チェック項目

- 新規エンドポイントを追加した場合はエンドポイント一覧テーブルと詳細節を更新すること
- リクエスト/レスポンス形式が変更された場合は対応する詳細節を更新すること
- 認可要件が変更された場合は一覧テーブルと詳細節の両方を更新すること
