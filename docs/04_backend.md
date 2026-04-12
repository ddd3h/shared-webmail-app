# バックエンド

> 最終更新: 2026-04-12

---

## バックエンド全体像

Next.js の **Route Handlers**（`src/app/api/` 配下の `route.ts`）がAPIエンドポイントを担当する。Node.js runtime で動作する（`export const runtime = 'nodejs'` は明示していないが、デフォルトでNode.js）。

バックグラウンド処理（IMAP同期・SMTP送信）は `src/workers/` 配下のスクリプトを `ts-node` で別プロセスとして実行するか、`src/instrumentation.node.ts` でNext.jsサーバー起動時にバックグラウンドループとして起動する。

---

## サーバー側の責務分離

| 責務 | 実装ファイル | 内容 |
|---|---|---|
| リクエスト認証 | `src/lib/auth.ts` | セッション取得・検証・Cookie設定 |
| 認可チェック | `src/lib/rbac.ts` | メールボックスごとのアクセス権限確認 |
| DB操作 | `src/lib/db.ts` + Prisma | Prismaクライアント経由でPostgreSQL操作 |
| 資格情報暗号化 | `src/lib/crypto.ts` | AES-GCM でIMAP/SMTPパスワードを暗号化/復号 |
| パスワードハッシュ | `src/lib/password.ts` | scrypt によるハッシュ生成・検証 |
| メール同期 | `src/lib/mail/sync.ts` | IMAP差分取得・メッセージ保存・スレッド統合 |
| メール接続テスト | `src/lib/mail/imap.ts`, `smtp.ts` | 接続確認のみ |
| SMTP送信 | `src/workers/send.ts`, `src/lib/mail/send-job.ts` | メッセージ送信・Sentフォルダ追記 |
| スレッド統合 | `src/lib/threading.ts` | In-Reply-To/References/件名マッチング |
| 件名正規化 | `src/lib/subject.ts` | Re:/Fwd: 除去・小文字化 |
| アプリ設定 | `src/lib/settings.ts` | DB (app_settings) ベースのKVストア |
| 監査ログ | `src/lib/audit.ts` | 操作ログの記録 |
| Push通知 | `src/lib/push.ts` | VAPID設定・購読者への通知送信 |
| VAPID鍵生成 | `src/lib/vapid.ts` | ECDSA P-256 鍵ペア生成 |
| キュー抽象化 | `src/lib/queue.ts` | インメモリキュー（MVP）/ 将来のBullMQ置換先 |

---

## Route Handlers の構成

全てのAPIは `src/app/api/` 配下の `route.ts` に実装されている。命名規則は Next.js App Router の規約に従う。

```
src/app/api/
├── auth/
│   ├── login/route.ts
│   ├── logout/route.ts
│   └── session/route.ts
├── passkeys/
│   ├── route.ts               # GET: 一覧
│   ├── [id]/route.ts          # GET/DELETE: 個別操作
│   ├── register-options/route.ts
│   ├── register/route.ts
│   ├── auth-options/route.ts
│   └── auth/route.ts
├── users/
│   ├── route.ts               # GET/POST
│   └── [id]/
│       ├── route.ts           # GET/PUT
│       └── avatar/route.ts
├── user/
│   ├── signature/route.ts
│   ├── avatar/route.ts
│   └── storage-recalc/route.ts
├── profile/
│   ├── password/route.ts
│   ├── password-reset-request/route.ts
│   └── password-reset/route.ts
├── mailboxes/
│   ├── route.ts               # GET/POST
│   └── [id]/
│       ├── route.ts           # GET/PUT/DELETE
│       ├── test/route.ts
│       ├── resync/route.ts
│       └── permissions/
│           ├── route.ts       # PUT
│           └── list/route.ts  # GET
├── threads/
│   ├── route.ts               # GET
│   └── [id]/
│       ├── route.ts           # GET
│       ├── assign/route.ts
│       ├── status/route.ts
│       ├── read/route.ts
│       ├── unread/route.ts
│       ├── hide/route.ts
│       ├── archive/route.ts
│       ├── delete/route.ts
│       ├── move/route.ts
│       └── mattermost/
│           ├── discuss/route.ts
│           ├── forward/route.ts
│           └── link/route.ts
├── messages/
│   ├── compose/route.ts
│   └── [id]/
│       ├── reply/route.ts
│       └── attachment/[attId]/route.ts
├── drafts/
│   ├── route.ts               # GET/POST
│   └── [id]/route.ts          # GET/PUT/DELETE
├── contacts/
│   ├── route.ts               # GET/POST
│   ├── [id]/route.ts          # GET/PUT/DELETE
│   └── google/
│       ├── auth/route.ts
│       ├── callback/route.ts
│       └── sync/route.ts
├── push/
│   ├── subscribe/route.ts
│   ├── vapid-public-key/route.ts
│   ├── test/route.ts
│   └── devices/
│       ├── route.ts
│       └── [id]/route.ts
├── dashboard/route.ts
├── admin/
│   ├── settings/
│   │   ├── route.ts
│   │   ├── generate-vapid/route.ts
│   │   └── vapid-public-key/route.ts
│   ├── users/route.ts
│   ├── audit-logs/route.ts
│   ├── connection-errors/route.ts
│   └── notification-errors/
│       ├── route.ts
│       └── [id]/retry/route.ts
└── cron/sync/route.ts
```

---

## 認証・認可の適用

**全てのRoute Handlerで最初に認証チェックを行う**。

```typescript
// 全エンドポイントの先頭で必ず実行
const session = await getSession();
requireAuth(session); // 未認証なら例外をthrow（401）
```

- `getSession()`: `src/lib/auth.ts` — Cookie から iron-sealed session を取得・検証
- `requireAuth(session)`: session が null なら `{ status: 401 }` のエラーをスロー

管理者専用エンドポイントは Middleware でも弾かれるが、Route Handler 内でも二重チェックを行うことが推奨される（コード上は Route Handler のみのものもある）。

---

## エラーハンドリング方針

明示的な共通エラーハンドラーは存在しない。各Route Handlerが個別にエラーをキャッチし、`NextResponse.json()` で返す。

```typescript
// 典型的なパターン
if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });
if (!canView) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
```

主なエラーコード:
- `not_found` → 404
- `forbidden` → 403
- `unauthorized` → 401（ログイン失敗時）
- `bad_request` / 入力バリデーションエラー → 400（Zodの `parse` 失敗は例外として上位に伝播、未キャッチの場合はNext.jsの500）

---

## バリデーション方針

リクエストボディのバリデーションは **Zod** を使用。スキーマは各Route Handler内でローカル定義される。

```typescript
// 例: src/app/api/users/route.ts
const schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['user', 'admin']).default('user'),
});
const input = schema.parse(body); // バリデーション失敗時は例外
```

`schema.parse()` の例外はキャッチされずに伝播するため、Next.js のエラーハンドリングに委ねられる（500エラーになる可能性あり）。

---

## Middleware との境界

`src/middleware.ts` は Edge runtime で動作し、以下のみを担当する：

1. 認証済みセッションの確認（未認証ならリダイレクト/401返却）
2. 管理者専用パスへのアクセス制御（`/admin/*`, `/api/admin/*`）
3. セッションクッキーのスライディングウィンドウ更新

**Middleware では DB アクセスやビジネスロジックは行わない**。

---

## メール処理の実装位置

| 処理 | ファイル |
|---|---|
| IMAP接続テスト | `src/lib/mail/imap.ts` → `testImapConnection()` |
| SMTP接続テスト | `src/lib/mail/smtp.ts` → `testSmtpConnection()` |
| IMAP同期（受信） | `src/lib/mail/sync.ts` → `syncMailbox()` |
| SMTP送信 | `src/lib/mail/send-job.ts`（要確認：`sendMailForMessage()`） |
| 送信Workerプロセス | `src/workers/send.ts` |
| 同期Workerプロセス | `src/workers/sync.ts` |
| 同期バックグラウンドループ | `src/instrumentation.node.ts` |

---

## 暗号化処理の実装位置

| 処理 | ファイル・関数 |
|---|---|
| メールパスワードの暗号化 | `src/lib/crypto.ts` → `encrypt()` |
| メールパスワードの復号 | `src/lib/crypto.ts` → `decrypt()` |
| Google OAuthトークンの暗号化 | `encrypt()` を使用（推定：要確認） |
| セッション暗号化 | iron-webcrypto → `src/lib/auth.ts` → `sealSession()` |
| パスワードハッシュ | `src/lib/password.ts` → `hashPassword()` / `verifyPassword()` |

---

## DBアクセスの設計方針

- `src/lib/db.ts` が Prisma Client のシングルトンを提供する（開発環境での hotreload によるインスタンス増殖を防ぐため `global` に格納）
- Route Handler 内で `prisma.xxx.findXxx()` / `prisma.xxx.create()` 等を直接呼び出す（リポジトリ層なし）
- トランザクションは `prisma.$transaction([...])` で明示

---

## バックグラウンド同期の動作

`src/instrumentation.node.ts` が Next.js のサーバー起動時に実行される。10秒の初期待機後、DB の `SYNC_DEFAULT_INTERVAL_SEC` 設定値（デフォルト不明、要確認）のインターバルで全メールボックスを同期するループを起動する。

ホットリロード時の重複ループ防止のため `(global as any).__imapSyncStarted` フラグを使用する。

---

## 今後エンドポイント追加時のルール

1. `src/app/api/{resource}/route.ts` を作成
2. 先頭で `getSession()` + `requireAuth(session)` を実行
3. 管理者専用の場合、`session.role !== 'admin'` チェックを追加
4. リクエストボディは `req.json().catch(() => ({}))` でパースし、Zod でバリデーション
5. 権限チェックは `src/lib/rbac.ts` の関数を利用するか、Prismaで直接チェック
6. 監査ログが必要な操作は `logAudit()` (`src/lib/audit.ts`) を呼び出す
7. `src/app/api/` に追加したら `docs/05_api.md` と `docs/appendix_routes_inventory.md` を更新する

---

## 更新時チェック項目

- `src/lib/` に新規ファイルを追加したら「サーバー側の責務分離」テーブルを更新すること
- Workerを追加した場合は `package.json` のスクリプトと合わせて記載すること
