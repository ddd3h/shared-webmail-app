# ディレクトリ構成

> 最終更新: 2026-04-12

---

## 主要ディレクトリツリー

```
webmail-app/
├── docs/                          # 技術ドキュメント（本ドキュメント群）
├── prisma/
│   ├── schema.prisma              # DBスキーマ定義（全モデルの唯一の源泉）
│   ├── migrations/                # マイグレーション履歴（10ファイル）
│   └── seed.mjs                   # 初期データ投入スクリプト
├── public/
│   ├── sw.js                      # Service Worker (PWA/Push通知)
│   ├── manifest.webmanifest       # PWAマニフェスト
│   └── icons/                     # PWAアイコン群（要確認: 存在は確認済み）
├── storage/
│   └── attachments/               # 添付ファイルのローカル保存先（.gitignore推奨）
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── layout.tsx             # ルートレイアウト（PWA meta, SWClient登録）
│   │   ├── globals.css            # グローバルCSS（Tailwind + カスタムクラス）
│   │   ├── page.tsx               # → (app)/page.tsx にリダイレクト（要確認）
│   │   ├── login/
│   │   │   ├── page.tsx           # ログイン画面（サーバーコンポーネント wrapper）
│   │   │   └── LoginForm.tsx      # ログインフォーム（クライアントコンポーネント）
│   │   ├── reset-password/
│   │   │   └── page.tsx           # パスワードリセット画面
│   │   ├── (app)/                 # 認証済みユーザー向けルートグループ
│   │   │   ├── layout.tsx         # 認証済みレイアウト（Navバー含む）
│   │   │   ├── page.tsx           # ダッシュボード
│   │   │   ├── threads/
│   │   │   │   ├── page.tsx       # スレッド一覧・メール作成
│   │   │   │   └── [id]/
│   │   │   │       └── page.tsx   # スレッド詳細
│   │   │   ├── notifications/
│   │   │   │   └── page.tsx       # 通知履歴・Push設定
│   │   │   ├── contacts/
│   │   │   │   └── page.tsx       # コンタクト管理
│   │   │   ├── profile/
│   │   │   │   └── page.tsx       # プロフィール・パスキー管理
│   │   │   └── admin/
│   │   │       ├── settings/
│   │   │       │   └── page.tsx   # 管理設定（メールアカウント・ユーザー・システム設定）
│   │   │       └── operations/
│   │   │           └── page.tsx   # 運用状況（同期エラー・通知エラー・監査ログ）
│   │   └── api/                   # Route Handlers（全62エンドポイント）
│   │       ├── auth/              # login / logout / session
│   │       ├── passkeys/          # WebAuthn登録・認証
│   │       ├── users/             # ユーザー管理
│   │       ├── user/              # 自分自身の操作（signature, avatar, storage-recalc）
│   │       ├── profile/           # パスワード変更・リセット
│   │       ├── mailboxes/         # メールボックス管理・権限・テスト・同期
│   │       ├── threads/           # スレッド一覧・詳細・操作
│   │       ├── messages/          # 送信・返信・添付ダウンロード
│   │       ├── drafts/            # 下書きCRUD
│   │       ├── contacts/          # コンタクト管理・Google連携
│   │       ├── push/              # Push購読・デバイス管理・テスト
│   │       ├── dashboard/         # ダッシュボードデータ
│   │       ├── admin/             # 管理者専用（設定・ログ・エラー）
│   │       └── cron/              # 同期トリガー（外部Cron用）
│   ├── components/
│   │   ├── Nav.tsx                # グローバルナビゲーション（ヘッダー + モバイルタブバー）
│   │   ├── RichEditor.tsx         # リッチテキストエディタ（返信・作成フォーム用）
│   │   └── DraftStatus.tsx        # 下書き保存状態表示コンポーネント
│   ├── hooks/
│   │   └── useDraft.ts            # 下書き自動保存フック
│   ├── lib/
│   │   ├── auth.ts                # セッション管理（getSession, setSessionCookie等）
│   │   ├── crypto.ts              # AES-256-GCM 暗号化/復号
│   │   ├── db.ts                  # Prismaクライアントシングルトン
│   │   ├── password.ts            # パスワードハッシュ (scrypt)
│   │   ├── rbac.ts                # 権限チェック関数
│   │   ├── audit.ts               # 監査ログ書き込み
│   │   ├── threading.ts           # メールスレッド統合ロジック
│   │   ├── subject.ts             # 件名正規化（Re:/Fwd:除去等）
│   │   ├── queue.ts               # インメモリキュー抽象化
│   │   ├── settings.ts            # DB管理アプリ設定（getSetting/setSetting）
│   │   ├── vapid.ts               # VAPID鍵生成
│   │   ├── push.ts                # Web Push送信（sendWebPushToUser）
│   │   ├── passkey-rp.ts          # WebAuthn Relying Party設定（getRpConfig）
│   │   └── mail/
│   │       ├── imap.ts            # IMAP接続テスト
│   │       ├── smtp.ts            # SMTP接続テスト
│   │       ├── sync.ts            # IMAP同期メインロジック
│   │       └── send-job.ts        # SMTP送信ジョブ実行（要確認: ファイル存在確認済み）
│   ├── middleware.ts               # 認証Middleware（Edge runtime）
│   ├── instrumentation.ts         # Next.js instrumentationフック（Entry Point）
│   ├── instrumentation.node.ts    # Node.jsランタイム用（IMAP同期バックグラウンドループ）
│   └── workers/                   # バックグラウンドWorker（ts-nodeで実行）
│       ├── sync.ts                # IMAP同期Worker
│       ├── send.ts                # SMTP送信Worker
│       ├── mattermost.ts          # Mattermostスタブ（未実装）
│       └── push.ts                # Push通知スタブ（未実装）
├── tests/                         # Vitestテストコード
│   ├── crypto.test.ts
│   ├── password.test.ts
│   ├── subject.test.ts
│   └── rbac.test.ts
├── next.config.js                 # Next.js設定（PWAヘッダーのみ）
├── tsconfig.json                  # TypeScript設定（パスエイリアス @/* → src/*）
├── tailwind.config.ts             # Tailwind設定
├── postcss.config.mjs             # PostCSS設定
├── vitest.config.ts               # Vitest設定
└── package.json                   # 依存関係・スクリプト定義
```

---

## 各ディレクトリの責務

### `src/app/api/`

Route Handlers の配置先。Next.js App Router の規約に従い `route.ts` というファイル名で配置する。各ファイルが HTTP メソッドごとに named export する（`GET`, `POST`, `PUT`, `DELETE`）。

**重要**: Route Handlers は Node.js runtime で動作する。Edge runtime は `middleware.ts` のみ。

### `src/app/(app)/`

認証済みユーザー向けのページ群。`(app)/layout.tsx` が `Nav.tsx` を含む共通レイアウトを提供する。

### `src/components/`

グローバルに利用される UI コンポーネント。現在は `Nav.tsx`、`RichEditor.tsx`、`DraftStatus.tsx` の3ファイルのみ。大型の画面固有コンポーネント（`ComposeModal`等）は `page.tsx` 内にインラインで定義されている。

### `src/lib/`

バックエンド処理の実装コア。Route Handlers から呼び出される。Edge runtime では使用不可（`middleware.ts` からは `auth.ts` の一部関数のみ使用可能）。

### `src/workers/`

長時間実行バックグラウンド処理。`ts-node` で直接実行する。現在 `sync.ts`（IMAP同期）と `send.ts`（SMTP送信）が実装済み。`mattermost.ts` と `push.ts` はスタブのみ。

### `prisma/`

スキーマと migration のみを格納する。`schema.prisma` が DBの唯一の情報源。

### `public/`

静的ファイル。`sw.js` はキャッシュ無効ヘッダーが `next.config.js` で設定されている（`no-cache, no-store, must-revalidate`）。

### `storage/`

添付ファイルの保存先（ローカルファイルシステム）。Git管理対象外にすること（`.gitignore` 要確認）。本番ではクラウドストレージへの移行が必要。

---

## どこに何を書くべきかのルール

| 実装内容 | 配置場所 |
|---|---|
| 新規APIエンドポイント | `src/app/api/{resource}/route.ts` |
| 新規ページ | `src/app/(app)/{page-name}/page.tsx` |
| バックエンド共通ロジック | `src/lib/{機能名}.ts` |
| 全画面共通UIコンポーネント | `src/components/{ComponentName}.tsx` |
| ページ固有コンポーネント | 該当 `page.tsx` 内にインライン（現在の慣習） |
| カスタムフック | `src/hooks/use{HookName}.ts` |
| DBスキーマ変更 | `prisma/schema.prisma` 編集 → `npx prisma migrate dev` |
| 長時間バックグラウンド処理 | `src/workers/{name}.ts` |
| 静的ファイル | `public/` 配下 |

---

## 追加開発時の配置ルール

- API Route Handler は必ず `src/app/api/` 配下に配置し、ファイル名は `route.ts` 固定
- 認証が必要なページは `src/app/(app)/` 配下に配置すること（`(app)/layout.tsx` がナビゲーションを提供）
- 認証不要のページ（ログイン等）は `src/app/` 直下に配置し、`middleware.ts` の `PUBLIC_PATHS` に追加すること
- サーバーのみで使用するコード（DB接続等）は `src/lib/` に置き、`'use client'` なファイルからインポートしないこと

---

## アンチパターン

- `src/middleware.ts` で `src/lib/db.ts` や `prisma` を `import` しないこと（Edge runtime ではNode.js APIが使えない）
- `src/workers/` のファイルを Next.js のビルドに含めないこと（ts-node で直接実行する）

---

## 更新時チェック項目

- ディレクトリが追加・削除された場合はツリーを更新すること
- 新規ファイルの責務が一行で説明できない場合は設計を見直すこと
