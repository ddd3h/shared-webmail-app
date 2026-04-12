# 既知の課題・TODO

> 最終更新: 2026-04-12  
> 記述方針: コード上で確認できた事実のみ。推測には「推定」と明記。

---

## 未実装箇所（コード上で確認済み）

### 高優先度

| # | 箇所 | 内容 | リスク |
|---|---|---|---|
| 1 | `src/workers/mattermost.ts` | Mattermost Bot API通信のスタブのみ。UI・DBモデルは整備済みだが実際の通知送信は動作しない | 機能未稼働 |
| 2 | `src/workers/push.ts` | Push通知Workerのスタブのみ。実際の通知送信は `src/lib/push.ts` の `sendWebPushToUser()` が直接呼ばれているが、Workerとしての管理は未実装 | 要確認 |
| 3 | `src/lib/queue.ts` | キューはインメモリ fire-and-forget のみ。プロセス再起動でキューが消失する。Redis/BullMQ への置き換えが必要 | データ損失リスク |
| 4 | Cookie `secure` 属性 | `src/lib/auth.ts` の `COOKIE_OPTIONS` に `secure: true` が設定されていない | 本番HTTPS環境でのセキュリティリスク |
| 5 | `storage/attachments/` | 添付ファイルのローカル保存。スケールアウト・サーバー障害時のデータ消失リスク | 本番環境での運用リスク |

### 中優先度

| # | 箇所 | 内容 | リスク |
|---|---|---|---|
| 6 | ログイン試行制限 | ブルートフォース対策（レート制限）の実装が確認できない | セキュリティリスク |
| 7 | SMTP送信リトライ | `message_sends` テーブルの `status='failed'` レコードへの自動リトライ機構がない | メール未送信のまま残留 |
| 8 | `.env.example` | リポジトリに `.env.example` が存在しない | 新メンバーのオンボーディング障壁 |
| 9 | 暗号鍵ローテーション | `ENCRYPTION_KEY_HEX` の安全なローテーション手順が未実装 | セキュリティ保守困難 |
| 10 | IMAP TLS検証 | `imap.ts` で `rejectUnauthorized: false`。本番での自己署名証明書対応のため意図的だが、MitM攻撃リスクがある | セキュリティリスク |

### 低優先度

| # | 箇所 | 内容 |
|---|---|---|
| 11 | `thread_state_history` | テーブルは存在するがUIへの表示未実装（推定） |
| 12 | `thread_visibility.is_hidden` フラグ | 非表示APIは実装済みだが現在のUIからは利用できない（推定） |
| 13 | `threads.is_archived` フラグ | アーカイブAPIは実装済みだがUIから削除済み（推定） |
| 14 | `message_sends.smtp_response` | SMTP応答が記録されるが管理画面での表示なし |

---

## コード上で確認できなかった項目（要確認）

| 項目 | 確認必要な内容 |
|---|---|
| `src/lib/mail/send-job.ts` | ファイルの実装内容（glob結果にあるが内容未読） |
| パスキー登録チャレンジの保存先 | セッション or DB に保存しているか。`src/app/api/passkeys/register-options/route.ts` の実装を確認すること |
| `VAPID_*` 環境変数の優先順位 | 環境変数と `app_settings` テーブルのどちらが優先されるか |
| `SYNC_DEFAULT_INTERVAL_SEC` のデフォルト値 | `app_settings` に未登録時の動作 |
| `workers/sync.ts` の実際のループ間隔 | `SYNC_DEFAULT_INTERVAL_SEC` を読んでいるか、ハードコードか |
| ESLint設定ファイルの有無 | `.eslintrc.*` がコードベースに存在するか |
| Docker/docker-compose の有無 | 存在しないとの判断は glob結果から。ただし確認は限定的 |
| `admin/users` API の実装 | `src/app/api/admin/users/route.ts` の実装内容 |
| Google OAuth の実装状態 | `src/app/api/contacts/google/callback/route.ts` でトークン暗号化の実装を確認すること |
| アバター機能の実装状態 | `src/app/api/user/avatar/route.ts` と `src/app/api/users/[id]/avatar/route.ts` の実装内容 |
| パスワードリセットフローのメール送信 | トークン発行後のメール送信（SMTP）の実装有無 |
| `NEXT_PUBLIC_APP_URL` の実際の使用箇所 | `src/` 内での参照を grep で確認すること |

---

## 引き継ぎ時に最初に確認すべき事項

1. **PostgreSQL が起動していること**: `psql -d webmail_app -c "\dt"` で接続確認
2. **`.env` ファイルが存在し正しく設定されていること**: 特に `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY_HEX`
3. **Prismaクライアントが最新であること**: `npx prisma generate` を実行してから `npm run dev`
4. **メールボックスの設定**: `/admin/settings` からIMAPアカウントを設定し、接続テストを実行
5. **VAPID鍵の設定**: `/admin/settings` でVAPID鍵を生成またはDBに設定済みか確認
6. **ログインできること**: `admin@example.com` / `admin1234`（初期値、変更済みの場合はシードスクリプトを確認）

---

## 優先度付き TODO

| 優先度 | TODO |
|---|---|
| 🔴 高 | Cookie `secure` 属性の本番環境設定（セキュリティ） |
| 🔴 高 | `.env.example` の作成（オンボーディング） |
| 🔴 高 | ログイン試行レート制限の実装 |
| 🟡 中 | キューのRedis/BullMQ移行（本番安定性） |
| 🟡 中 | 添付ファイルのS3/GCS移行（本番スケール） |
| 🟡 中 | Mattermost Bot API通信の実装 |
| 🟡 中 | SMTP送信リトライ機構の実装 |
| 🟢 低 | 暗号鍵ローテーション手順の文書化・実装 |
| 🟢 低 | APIテスト / 統合テストの追加 |
| 🟢 低 | E2Eテストの追加 |
| 🟢 低 | CI/CD パイプラインの設定 |

---

## 更新時チェック項目

- 未実装箇所が実装されたら「未実装箇所」テーブルから削除すること
- 新たな問題が発見されたら「要確認」または「未実装箇所」テーブルに追記すること
- TODO が完了したら「優先度付きTODO」テーブルを更新すること
