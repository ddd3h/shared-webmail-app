# 変更ガイド

> 最終更新: 2026-04-12

---

## 新規画面追加時

### ファイル作成

```
src/app/(app)/{page-name}/page.tsx
```

先頭に `'use client'` を付ける（全認証済みページがClient Component）。

### 必要な確認・変更

1. **ナビゲーションへの追加**: `src/components/Nav.tsx` のリンクに追加
2. **管理者専用ページの場合**: `src/middleware.ts` のパスチェックは `/admin` プレフィックスで自動対応済み
3. **公開ページの場合**: `src/middleware.ts` の `PUBLIC_PATHS` に追加
4. **対応APIの作成**: 下記「新規API追加時」を参照
5. **テストの追加**: `tests/components/` にコンポーネントテストを追加

### ドキュメント更新

- `docs/03_frontend.md` の「主要画面一覧」テーブルを更新

---

## 新規API追加時

### ファイル作成

```
src/app/api/{resource}/route.ts
```

### 最小実装テンプレート

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { z } from 'zod';

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const body = await req.json().catch(() => ({}));
  const input = z.object({ /* バリデーション定義 */ }).parse(body);

  // ビジネスロジック

  return NextResponse.json({ ok: true });
}
```

### チェックリスト

- [ ] `getSession()` + `requireAuth(session)` を先頭に追加
- [ ] 管理者専用の場合: `if (session.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });`
- [ ] リクエストボディの Zod バリデーション
- [ ] リソースの存在確認（404返却）
- [ ] 権限チェック（`src/lib/rbac.ts` の関数を利用 or Prismaで直接チェック）
- [ ] 監査ログ記録: `await logAudit({ actorUserId, actionType, targetType, targetId, metadata: {} })`
- [ ] エラー時は `NextResponse.json({ error: 'xxx' }, { status: 4xx })` で返却
- [ ] **テストの追加**: `tests/api/` に正常系・異常系・認可エラーのテストを追加

### ドキュメント更新

- `docs/05_api.md` のエンドポイント一覧テーブルと詳細節を追加
- `docs/appendix_routes_inventory.md` に追記

---

## DBスキーマ変更時

### 手順

```bash
# 1. prisma/schema.prisma を編集

# 2. migration 作成・適用
npx prisma migrate dev --name <変更名>

# 3. Prismaクライアント再生成
npx prisma generate

# 4. 開発サーバー再起動（型エラーが出る場合）
# Ctrl+C → npm run dev
```

### チェックリスト

- [ ] 既存データへの影響確認（NOT NULL追加、型変更等）
- [ ] `npx tsc --noEmit` で TypeScript エラーがないか確認
- [ ] 関連する Route Handler の Select/Where 節を更新
- [ ] 本番適用前に `npx prisma migrate deploy` での動作確認

### ドキュメント更新

- `docs/06_database.md` の該当モデルのテーブルを更新
- migration を追加した場合は「migration 運用状況」テーブルに追記
- `docs/appendix_schema_reference.md` を更新

---

## 認証付き機能追加時

### 認証チェックの適用

全ての Route Handler に `getSession()` + `requireAuth()` を追加する（公開エンドポイント以外）。

### 権限（RBAC）の追加・変更

1. **既存の権限フラグ** (`can_view`, `can_reply`, `can_assign`) で対応できる場合:  
   → `src/lib/rbac.ts` の対応関数を呼び出す

2. **新しい権限フラグが必要な場合**:  
   → `mailbox_permissions` に新カラムを追加（DB変更手順を参照）  
   → `src/lib/rbac.ts` に新関数を追加  
   → `src/app/api/threads/[id]/route.ts` の permissions 返却ロジックを更新  
   → フロントエンドでの表示制御を追加

### ドキュメント更新

- `docs/07_auth_session_security.md` の「認可の考え方」節を更新

---

## メール機能改修時

### 受信（IMAP）の変更

- **メイン処理**: `src/lib/mail/sync.ts` の `syncMailbox()` 関数
- **スレッド統合**: `src/lib/threading.ts` の `findOrCreateThread()` 関数
- **件名正規化**: `src/lib/subject.ts` の `normalizeSubject()` 関数（テストあり: `tests/subject.test.ts`）

改修後は必ず `npm run test` でテストを実行すること。

### 送信（SMTP）の変更

- **メイン処理**: `src/lib/mail/send-job.ts`（`sendMailForMessage()` 関数）
- **接続テスト**: `src/lib/mail/smtp.ts`（`testSmtpConnection()` 関数）

### ドキュメント更新

- `docs/08_email_integration.md` の該当節を更新

---

## Push通知改修時

### 送信ロジックの変更

- **送信**: `src/lib/push.ts` の `sendWebPushToUser()` 関数
- **受信（Service Worker）**: `public/sw.js`

### 購読フローの変更

- `src/app/sw-client.tsx`（クライアント側）
- `src/app/api/push/subscribe/route.ts`（サーバー側）

### VAPID鍵の変更

VAPID鍵を変更すると全ユーザーのPush購読が無効になる。鍵変更前に全ユーザーへの周知と、変更後の再購読案内が必要。

### ドキュメント更新

- `docs/09_pwa_push.md` の該当節を更新

---

## 変更時の安全チェックリスト

全ての変更前に確認すること:

- [ ] 既存のテストが通るか: `npm run test`
- [ ] TypeScript エラーがないか: `npx tsc --noEmit`
- [ ] DBスキーマ変更の場合、既存データへの影響を確認
- [ ] 認証・権限を変更した場合、影響範囲（全APIエンドポイント）を確認
- [ ] セキュリティに関わる変更は `docs/07_auth_session_security.md` の「既知のリスク」を再確認
- [ ] メール機能の変更は手動でスレッド統合の動作を確認

---

## 変更後に更新すべきドキュメント一覧

| 変更内容 | 更新ドキュメント |
|---|---|
| 新規ページ追加 | `docs/03_frontend.md` |
| 新規API追加 | `docs/05_api.md`, `docs/appendix_routes_inventory.md` |
| DBスキーマ変更 | `docs/06_database.md`, `docs/appendix_schema_reference.md` |
| 認証・権限ロジック変更 | `docs/07_auth_session_security.md` |
| メール処理変更 | `docs/08_email_integration.md` |
| Push/PWA変更 | `docs/09_pwa_push.md` |
| 環境変数追加 | `docs/10_environment_variables.md` |
| セットアップ手順変更 | `docs/11_setup_run_deploy.md` |
| テスト追加 | `docs/12_testing_and_quality.md` |
| 課題解決・新課題発生 | `docs/13_known_issues_and_todos.md` |
| 依存パッケージ変更 | `docs/appendix_dependencies.md` |

---

## 継続運用のための更新ルール

1. **ドキュメントはコードと同時に更新すること**（PRのdescriptionにdocs更新を含める）
2. **推測で書かない**。不明な場合は「要確認」と記載する
3. **古い情報を放置しない**。変更が生じたら対応するドキュメントを必ず更新する
4. **実装状況の変化は `docs/13_known_issues_and_todos.md` に反映する**
5. **各ドキュメント先頭の「最終更新」日付を更新する**
