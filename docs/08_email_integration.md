# メール連携

> 最終更新: 2026-04-12

---

## メール連携全体概要

| 機能 | ライブラリ | ファイル |
|---|---|---|
| IMAP受信・同期 | imapflow ^1.0.164 | `src/lib/mail/sync.ts`, `src/lib/mail/imap.ts` |
| SMTP送信 | nodemailer ^8.0.5 | `src/lib/mail/smtp.ts`, `src/workers/send.ts` |
| メール解析 | mailparser ^3.9.0 | `src/lib/mail/sync.ts` 内で利用 |
| 接続テスト | imapflow + nodemailer | `src/lib/mail/imap.ts`, `src/lib/mail/smtp.ts` |

---

## IMAP受信フロー

### 処理の起点

以下の2つのトリガーでIMAP同期が起動する:

1. **バックグラウンドループ** (`src/instrumentation.node.ts`)  
   → Next.jsサーバー起動時に10秒後に開始。`SYNC_DEFAULT_INTERVAL_SEC`（`app_settings` DB値）のインターバルで継続実行。

2. **手動同期** (`POST /api/mailboxes/[id]/resync`)  
   → 管理画面または API からの手動トリガー。

3. **Cronジョブ** (`GET /api/cron/sync`)  
   → 外部Cronからのトリガー。全アクティブメールボックスを同期。

4. **Workerプロセス** (`src/workers/sync.ts`)  
   → `npm run worker:sync` で起動する独立プロセス。

### `syncMailbox()` の処理詳細

**ファイル**: `src/lib/mail/sync.ts`

```
syncMailbox(mailboxId)
  ↓
1. mailboxes + credentials + permissions を取得
2. credentials.encrypted_password を decrypt() で復号
3. ImapFlow でIMAPサーバーに接続
4. INBOXを選択
5. last_seen_uid から UID:* で差分取得
6. 各メッセージを処理:
   a. external_message_id（Message-ID）で重複チェック
   b. mailparser でエンベロープ解析（Subject, From, To, Cc, Date, In-Reply-To, References）
   c. 本文取得（text_body, html_body）
   d. 添付ファイル取得・保存（storage/attachments/{uuid}{ext}）
   e. findOrCreateThread() でスレッド統合
   f. messages テーブルにINSERT
   g. threads.unread_count をインクリメント（個人メール）
      または thread_reads を削除（チームメール = 未読扱いに）
7. mailbox_sync_states を更新（last_seen_uid, last_success_at 等）
8. 新着メッセージがあれば通知処理:
   - チームメール: can_view=true の全ユーザーに通知
   - 個人メール: owner_user_id のユーザーに通知
   - notification_events 作成 + sendWebPushToUser() 呼び出し
```

### スレッド統合ロジック

**ファイル**: `src/lib/threading.ts` → `findOrCreateThread()`

優先順位順にマッチング:

1. **In-Reply-To ヘッダ**: 参照している `external_message_id` を持つメッセージのスレッドを返す
2. **References ヘッダ**: スペース区切りのメッセージID群から最新の一致を探す
3. **正規化件名マッチング**: 同じ `normalized_subject` + 同じメールボックス + 30日以内のスレッドを返す
4. **新規スレッド作成**: 上記で一致なし

件名の正規化（`src/lib/subject.ts`）:
- `Re:`, `Fwd:`, `FW:`, `RE:` 等のプレフィックスを除去
- 前後の空白を除去
- 連続空白を圧縮
- 小文字化

---

## SMTP送信フロー

### 処理の起点

1. ユーザーが返信フォームまたは新規作成フォームを送信
2. `POST /api/messages/[id]/reply` または `POST /api/messages/compose` で受信
3. `messages` テーブルに `direction='outgoing'` でレコード作成
4. `message_sends` テーブルに `status='pending'` でジョブ作成
5. `sendMailForMessage(messageId)` を fire-and-forget で呼び出し

### `sendMailForMessage()` の処理詳細

**ファイル**: `src/lib/mail/send-job.ts`（要確認: ファイル名）

```
sendMailForMessage(messageId)
  ↓
1. message + mailbox + credentials を取得
2. credentials.encrypted_password を decrypt() で復号
3. nodemailer.createTransport() で SMTPトランスポーター作成
4. メール送信（from, to, cc, bcc, subject, text, html, attachments）
5. message_sends.status を 'success' に更新（smtp_response を記録）
6. messages.external_message_id を SMTP応答のメッセージIDで更新
7. IMAP Sent フォルダへの追記を試みる（複数フォルダ名でフォールバック）
```

### SMTP送信エラー時

- `message_sends.status` を `'failed'`、`error_message` にエラー詳細を記録
- リトライ機構は現在未実装（要確認）

---

## 添付ファイルの取り扱い

### 受信時（IMAP同期）

- `storage/attachments/{uuid}{ext}` にファイル保存
- `attachments` テーブルに `storage_key`, `filename`, `content_type`, `size` を記録

### 送信時（SMTP）

- フロントエンドから `multipart/form-data` でアップロード
- Route Handler でサーバーローカルの `storage/attachments/` に一時保存
- nodemailer に `attachments` として渡す

### ダウンロード

- `GET /api/messages/[id]/attachment/[attId]`
- `attachments.storage_key` のパスからファイルを読み込んで返す

> **本番注意**: 現在はローカルファイルシステムに保存。スケールアウト・サーバー障害対策にはS3/GCS等への移行が必要。

---

## 接続設定・必要な環境変数

メールアカウントごとに `mailbox_credentials` テーブルに保存される。管理画面から設定する。

| 設定項目 | 説明 |
|---|---|
| `username` | IMAPログインユーザー名 |
| `encrypted_password` | AES-GCM暗号化パスワード |
| `imap_host` | IMAPホスト名 |
| `imap_port` | IMAPポート番号（通常993） |
| `imap_secure` | SSL/TLS（通常true） |
| `smtp_host` | SMTPホスト名 |
| `smtp_port` | SMTPポート番号（通常465） |
| `smtp_secure` | SSL/TLS（通常true） |

復号には `ENCRYPTION_KEY_HEX` 環境変数が必要。

---

## 同期タイミング

| トリガー | タイミング |
|---|---|
| バックグラウンドループ | サーバー起動後10秒 + `SYNC_DEFAULT_INTERVAL_SEC` 秒おき |
| 手動同期 | ユーザーが管理画面から「同期」ボタンを押下 |
| Cronジョブ | 外部スケジューラー（例: crontab、Vercel Crons） |
| Workerプロセス | 独立プロセスとして常時起動 |

---

## エラーハンドリング

- 同期中のエラーは `mailbox_sync_states.last_error` に記録
- `mailbox_sync_states.status` が `"error"` になる
- IMAP接続失敗時はログ出力のみ（リトライなし、要確認）
- SMTP送信失敗は `message_sends` テーブルに記録（自動リトライなし）

---

## 障害時の確認ポイント

1. `mailbox_sync_states` テーブルの `last_error`, `status` を確認
2. 管理画面 `/admin/operations` の「接続エラー」セクション（`GET /api/admin/connection-errors`）
3. サーバーログ（`console.error` 出力）
4. `message_sends` テーブルの `status='failed'` レコード
5. 管理画面 `/admin/operations` の「通知エラー」セクション

---

## IMAP TLS設定の注意

`src/lib/mail/imap.ts` では `rejectUnauthorized: false` が設定されている（自己署名証明書対策）。本番環境で信頼できないサーバーへの接続をする場合はセキュリティリスクになる（要確認・要検討）。

---

## 更新時チェック項目

- IMAPライブラリ（imapflow）をアップデートした場合はAPIの変更を確認すること
- スレッド統合ロジックを変更した場合は `src/lib/threading.ts` のテストを実行すること
- 添付ファイルのストレージをS3等に移行した場合は本ドキュメントのパスを更新すること
