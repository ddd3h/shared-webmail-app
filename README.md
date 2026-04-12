# 社内向け共有メールワークスペース

本リポジトリは「IMAP/SMTP ベースの共有メール運用システム」の MVP 実装用スケルトンです。仕様は `docs/` とユーザー提供の開発指示書に準拠します。

## 構成
- Next.js(App Router) を用いた Web アプリと API ルート（`src/app`）
- Prisma による DB スキーマ（`prisma/schema.prisma`）
- 非同期処理用 Worker スタブ（`src/workers/`）
- PWA/Service Worker スタブ（`public/`）
- 設計ドキュメント（`docs/`）

## セットアップ / 起動
- 環境変数: `.env` を `.env.example` から作成し編集（`DATABASE_URL`/`SESSION_SECRET`/`ENCRYPTION_KEY_HEX`）
- 依存パッケージ: `npm install`
- DB 初期化: `npx prisma migrate dev --name init`
- 初回ユーザー作成（ブートストラップ）: `POST /api/admin/users` に `name/email/password`
- アプリ起動: `npm run dev`
- ワーカー起動（別ターミナル）:
  - 同期: `npm run worker:sync`
  - 送信: `npm run worker:send`
  - Push: `npm run worker:push`
  - Mattermost: `npm run worker:mattermost`

## 使い方（MVP）
- ログイン: `/login`（作成したユーザーで）
- システム設定: `/admin/settings`（VAPID 生成、Mattermost 設定、同期間隔）
- メールボックス: `/mailboxes`（作成・接続テスト・権限設定）
- スレッド: `/threads` → 詳細で履歴/返信（送信後は Worker が SMTP 送信）
- 手動同期: `POST /api/mailboxes/:id/resync`（または同期待ち）
- 運用状況: `/admin/operations`（接続・同期・通知失敗・監査ログ、通知再試行）

## 実装済み機能（概要）
- 認証/セッション（scrypt）/ユーザー作成ブートストラップ
- Prisma スキーマ（仕様 10.x を反映）
- メールボックス CRUD + 接続テスト（資格情報は AES-GCM で暗号化保存）
- IMAP 同期（INBOX 差分取り込み、スレッド化、添付保存、未読計上、通知イベント発火）
- スレッド API/画面（一覧/詳細/返信/担当/ステータス/非表示/アーカイブ/Mattermost リンク・転送）
- 送信 Worker（SMTP 送信、Message-Id 反映、Sent フォルダに APPEND）
- 通知（Web Push + 配信記録、通知失敗の再試行）
- Mattermost Worker（スタブ実装）
- RBAC（管理者上書き、チーム所有ルール: チームメンバーは閲覧可）
- 管理画面（設定/運用状況/監査ログ）

## 注意事項
- 添付はローカル `storage/attachments` に保存。実運用では S3/GCS 等に置き換え可能。
- 送信後の APPEND はサーバ環境に依存するためフォルダ名を複数試行（Sent/Sent Items/INBOX.Sent/送信済みメール）。
- RBAC は MVP 実装。細かいチームロールの権限は将来拡張。

## 優先実装フェーズ
- Phase 1: 認証/DB基盤/メールボックス登録/接続テスト/同期 Worker/一覧・詳細/返信
- Phase 2: 担当/ステータス/非表示/アーカイブ/監査ログ/管理
- Phase 3: Mattermost 連携
- Phase 4: PWA・Web Push

## 注意
- このリポジトリはスケルトンです。API/画面/Worker は最小の叩き台のみを含みます。
- 仕様と実装の差異があれば仕様（指示書）を正とします。
