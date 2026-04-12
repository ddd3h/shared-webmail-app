# 付録: Prismaスキーマリファレンス

> 最終更新: 2026-04-12  
> ソースファイル: `prisma/schema.prisma`

---

## 概要

| 項目 | 値 |
|---|---|
| generator | `prisma-client-js` |
| datasource provider | `postgresql` |
| datasource url | `env("DATABASE_URL")` |
| モデル数 | 24 |
| Enum数 | 6 |
| migration数 | 10 |

---

## Enum一覧

```prisma
enum MailboxType   { personal  team }
enum MessageDirection { incoming  outgoing }
enum ThreadStatus  { open  in_progress  waiting  done  archived }
enum JobStatus     { pending  success  failed }
enum NotificationPriority { high  normal  low }
enum AuthType      { password  oauth }
```

---

## モデル一覧

| モデル名 | DBテーブル名 | 主な関連 |
|---|---|---|
| `users` | `users` | mailboxes, threads, push_subscriptions, passkey_credentials 等 |
| `teams` | `teams` | team_members, mailboxes |
| `team_members` | `team_members` | teams, users |
| `mailboxes` | `mailboxes` | users, teams, mailbox_credentials, threads 等 |
| `mailbox_credentials` | `mailbox_credentials` | mailboxes（1:1） |
| `mailbox_permissions` | `mailbox_permissions` | mailboxes, users |
| `mailbox_sync_states` | `mailbox_sync_states` | mailboxes（1:1） |
| `threads` | `threads` | mailboxes, users, messages 等 |
| `messages` | `messages` | threads, mailboxes, attachments, message_sends |
| `attachments` | `attachments` | messages |
| `thread_assignments` | `thread_assignments` | threads, users |
| `thread_state_history` | `thread_state_history` | threads, users |
| `thread_visibility` | `thread_visibility` | threads, users |
| `thread_reads` | `thread_reads` | threads, users |
| `message_sends` | `message_sends` | messages, threads, mailboxes, users |
| `mattermost_links` | `mattermost_links` | threads, users |
| `mattermost_notifications` | `mattermost_notifications` | threads, users |
| `mattermost_forwards` | `mattermost_forwards` | threads, messages, users |
| `push_subscriptions` | `push_subscriptions` | users |
| `notification_events` | `notification_events` | users, threads |
| `notification_deliveries` | `notification_deliveries` | notification_events |
| `audit_logs` | `audit_logs` | users |
| `app_settings` | `app_settings` | — |
| `passkey_credentials` | `passkey_credentials` | users |
| `contacts` | `contacts` | users |
| `google_oauth_tokens` | `google_oauth_tokens` | users（1:1） |
| `password_reset_tokens` | `password_reset_tokens` | users |
| `drafts` | `drafts` | users, mailboxes, threads |

---

## Unique制約一覧

| モデル | Unique制約 |
|---|---|
| `users` | `email` |
| `team_members` | `(team_id, user_id)` |
| `mailbox_credentials` | `mailbox_id` |
| `mailbox_permissions` | `(mailbox_id, user_id)` |
| `mailbox_sync_states` | `mailbox_id` |
| `messages` | `external_message_id` |
| `thread_visibility` | `(thread_id, user_id)` |
| `thread_reads` | `(thread_id, user_id)` |
| `mattermost_links` | `thread_id` |
| `push_subscriptions` | `endpoint` |
| `app_settings` | `key` |
| `passkey_credentials` | `credential_id` |
| `contacts` | `google_id` |
| `google_oauth_tokens` | `user_id` |
| `password_reset_tokens` | `token` |

---

## Cascade削除設定

| 子モデル | 親モデル | 動作 |
|---|---|---|
| `passkey_credentials` | `users` | CASCADE |
| `google_oauth_tokens` | `users` | CASCADE |
| `password_reset_tokens` | `users` | CASCADE |
| `thread_reads` | `threads` | CASCADE |
| `thread_reads` | `users` | CASCADE |

---

## 更新時チェック項目

- `prisma/schema.prisma` を変更したら本ドキュメントと `docs/06_database.md` を更新すること
