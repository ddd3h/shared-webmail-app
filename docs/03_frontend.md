# フロントエンド

> 最終更新: 2026-04-12

---

## フロントエンドの構成方針

- **Next.js 16 App Router** を使用。`src/app/` 配下のファイルがルーティングの基準。
- 認証済みページは `src/app/(app)/` ルートグループに集約し、共通レイアウト (`(app)/layout.tsx`) でナビゲーションを提供。
- ほぼ全ての画面は **Client Component** (`'use client'`)。データ取得は `useEffect` + `fetch` でクライアントサイドから行う。
- Server Component はルートレイアウト (`layout.tsx`) や静的な wrapper ページ（`login/page.tsx` 等）に限定。
- スタイリングは **Tailwind CSS** + `src/app/globals.css` に定義したカスタムクラス（`.btn-*`, `.card`, `.input` 等）。

---

## App Router 構成

```
src/app/
├── layout.tsx              # ルートレイアウト（Server Component）
│                             - <html>, <head> の設定
│                             - PWA manifest リンク
│                             - Apple Web App meta タグ
│                             - <SWClient /> でService Worker登録
├── globals.css             # グローバルスタイル
├── login/
│   ├── page.tsx            # Server Component wrapper
│   └── LoginForm.tsx       # 'use client' — フォーム・Passkey認証ロジック
├── reset-password/
│   └── page.tsx            # パスワードリセット画面（'use client'）
└── (app)/
    ├── layout.tsx          # 認証済みレイアウト（'use client'）
    │                         - <Nav /> を含む
    ├── page.tsx            # ダッシュボード（'use client'）
    ├── threads/
    │   ├── page.tsx        # スレッド一覧 + メール作成モーダル（'use client'）
    │   └── [id]/page.tsx   # スレッド詳細（'use client'）
    ├── notifications/page.tsx   # 通知履歴・Push購読設定（'use client'）
    ├── contacts/page.tsx        # コンタクト管理（'use client'）
    ├── profile/page.tsx         # プロフィール・パスキー管理（'use client'）
    └── admin/
        ├── settings/page.tsx    # 管理設定（'use client'）
        └── operations/page.tsx  # 運用状況（'use client'）
```

---

## 主要画面一覧

| ルート | 画面名 | 役割 | 主要なAPIコール | 認証要否 |
|---|---|---|---|---|
| `/login` | ログイン | パスワード/パスキー認証 | `POST /api/auth/login`, `POST /api/passkeys/auth` | 不要 |
| `/reset-password` | パスワードリセット | リセットトークン入力・新パスワード設定 | `POST /api/profile/password-reset-request`, `POST /api/profile/password-reset` | 不要 |
| `/` | ダッシュボード | 担当スレッド統計・個人メール容量・最近のチームスレッド | `GET /api/dashboard` | 必要 |
| `/threads` | スレッド一覧 | メール一覧・フィルタ・検索・複数選択・新規作成モーダル | `GET /api/threads`, `POST /api/messages/compose`, `GET /api/drafts` | 必要 |
| `/threads/[id]` | スレッド詳細 | メール本文表示・返信・担当変更・ステータス変更・削除 | `GET /api/threads/[id]`, `POST /api/messages/[id]/reply`, `POST /api/threads/[id]/assign` | 必要 |
| `/notifications` | 通知設定 | Push購読登録・デバイス管理 | `GET /api/push/devices`, `POST /api/push/subscribe`, `POST /api/push/test` | 必要 |
| `/contacts` | コンタクト管理 | 社内アドレス帳・Google同期 | `GET /api/contacts`, `POST /api/contacts`, Google OAuth | 必要 |
| `/profile` | プロフィール | パスワード変更・署名編集・パスキー管理・アバター設定 | `POST /api/profile/password`, `POST /api/user/signature`, `GET /api/passkeys` | 必要 |
| `/admin/settings` | 管理設定 | メールアカウント管理・ユーザー管理・システム設定 | `GET /api/mailboxes`, `GET /api/users`, `GET /api/admin/settings` | 必要（管理者のみ） |
| `/admin/operations` | 運用状況 | 同期エラー・通知エラー・監査ログ | `GET /api/admin/connection-errors`, `GET /api/admin/notification-errors`, `GET /api/admin/audit-logs` | 必要（管理者のみ） |

---

## コンポーネント設計方針

### グローバルコンポーネント (`src/components/`)

| コンポーネント | ファイル | 役割 |
|---|---|---|
| `Nav` | `Nav.tsx` | ヘッダーナビ（デスクトップ）+ モバイルタブバー + メニューシート |
| `RichEditor` | `RichEditor.tsx` | ContentEditable ベースのリッチテキストエディタ（返信・作成用） |
| `DraftStatus` | `DraftStatus.tsx` | 下書き保存状態インジケータ（idle/saving/saved/error） |

### ページ固有コンポーネント

現在の設計では、ページ固有の大型コンポーネント（`ComposeModal`、`InlineDropdown` 等）は該当 `page.tsx` の中にインライン定義されている。

---

## 状態管理の方法

グローバル状態管理ライブラリ（Redux、Zustand等）は**使用していない**。各ページコンポーネントが `useState` でローカル状態を保持する。

```typescript
// 典型的なパターン（threads/[id]/page.tsx から抜粋）
const [data, setData] = useState<ThreadData | null>(null);
const [loading, setLoading] = useState(true);
const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
```

トースト通知は `msg` ステートで管理し、4秒後に `setTimeout` でクリアするパターンを使用（各ページに実装）。

---

## データ取得方法

**全て `useEffect` + `fetch` によるクライアントサイドフェッチ**。SWR/React Query は使用していない。

```typescript
// 典型的なパターン（useEffect + fetch）
useEffect(() => {
  async function load() {
    const res = await fetch('/api/threads');
    const data = await res.json();
    setItems(data.items || []);
  }
  load();
}, []);
```

---

## Server Component / Client Component の使い分け

| コンポーネント種別 | 使用箇所 |
|---|---|
| Server Component | `app/layout.tsx`（ルートレイアウト）、`app/login/page.tsx`（wrapper のみ） |
| Client Component (`'use client'`) | 全ての `(app)/` 配下ページ、`LoginForm.tsx`、`Nav.tsx`、`RichEditor.tsx`、`DraftStatus.tsx` |

---

## フォーム処理・バリデーション

フロントエンドでの明示的なバリデーションは最小限（`required` 属性等）。主なバリデーションは**サーバーサイド**の Route Handler 内で Zod を使用して行う。

---

## UIライブラリ・Tailwind 運用方針

Tailwind CSS のユーティリティクラスを直接使用。`src/app/globals.css` に以下のカスタムクラスが定義されている：

| クラス | 用途 |
|---|---|
| `.btn` | ボタン基底スタイル |
| `.btn-primary` | プライマリボタン（青） |
| `.btn-secondary` | セカンダリボタン（グレー） |
| `.btn-danger` | 危険操作ボタン（赤） |
| `.btn-success` | 成功ボタン（緑） |
| `.btn-sm` | 小サイズボタン修飾子 |
| `.btn-ghost` | 背景なしボタン |
| `.card` | カードコンテナ |
| `.input` | テキスト入力フィールド |
| `.select` | セレクトボックス |
| `.label` | フォームラベル |
| `.badge-*` | ステータスバッジ（`open`, `in_progress`, `done` 等） |

---

## フロントからAPIをどう呼んでいるか

全て `fetch()` の直接呼び出し。API クライアントライブラリは使用していない。

```typescript
// 典型的なAPIコールパターン
const res = await fetch(`/api/threads/${id}/assign`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ user_id: userId })
});
if (!res.ok) {
  const data = await res.json().catch(() => ({}));
  showMsg('error', data.error || '操作に失敗しました');
  return;
}
```

---

## 主要画面の特記事項

### `/threads` (スレッド一覧)

- フィルタ: ステータス・メールボックス種別・タブ（全て/未読/送信済み/下書き/自分担当）
- 検索プレフィックス: `from:`, `to:`, `subject:`, `has:attachment`, `after:`, `before:`
- 複数選択: チェックボックスで選択 → 一括ステータス変更・削除
- 新規作成: `ComposeModal` コンポーネント（インライン定義、下書き自動保存付き）

### `/threads/[id]` (スレッド詳細)

- 権限に応じて返信ボタン・担当変更ドロップダウンの表示を制御（`data.permissions.can_reply`, `data.permissions.can_assign`）
- チームメール: ステータス変更ドロップダウン・Mattermostボタン表示
- 全メッセージを時系列で表示。最新メッセージのみ展開、他は折りたたみ

### `LoginForm.tsx`

- パスワードログインとパスキーログインの両方をサポート
- `@simplewebauthn/browser` の `startAuthentication()` を使用
- `suppressHydrationWarning` を `<form>` と入力ラッパー `<div>` に付与（パスワードマネージャー拡張によるHydrationエラー対策）

---

## 今後画面追加する際の流れ

1. `src/app/(app)/{page-name}/page.tsx` を作成（`'use client'` を先頭に付ける）
2. `src/components/Nav.tsx` のナビゲーションリンクに追加（必要な場合）
3. 管理者専用ページの場合は `src/middleware.ts` の admin パスチェックに `pathname.startsWith('/admin/{page-name}')` を確認（既存の `/admin` プレフィックスチェックで対応済み）
4. 対応する API を `src/app/api/` に追加（[04_backend.md](./04_backend.md) 参照）

---

## 更新時チェック項目

- 新規ページを追加したら「主要画面一覧」テーブルを更新すること
- グローバルコンポーネントを追加したら `src/components/` のテーブルを更新すること
- Tailwind カスタムクラスを追加したら `globals.css` の説明表を更新すること
