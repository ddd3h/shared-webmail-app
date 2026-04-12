# 付録: APIルート在庫表

> 最終更新: 2026-04-12  
> 対象: `src/app/api/` 配下の全 `route.ts`（62ファイル）

実装ファイルのパスとAPIパスの完全対照表。

---

| Method | APIパス | 実装ファイルパス |
|---|---|---|
| POST | `/api/auth/login` | `src/app/api/auth/login/route.ts` |
| POST | `/api/auth/logout` | `src/app/api/auth/logout/route.ts` |
| GET | `/api/auth/session` | `src/app/api/auth/session/route.ts` |
| GET | `/api/passkeys/register-options` | `src/app/api/passkeys/register-options/route.ts` |
| POST | `/api/passkeys/register` | `src/app/api/passkeys/register/route.ts` |
| POST | `/api/passkeys/auth-options` | `src/app/api/passkeys/auth-options/route.ts` |
| POST | `/api/passkeys/auth` | `src/app/api/passkeys/auth/route.ts` |
| GET | `/api/passkeys` | `src/app/api/passkeys/route.ts` |
| GET | `/api/passkeys/[id]` | `src/app/api/passkeys/[id]/route.ts` |
| DELETE | `/api/passkeys/[id]` | `src/app/api/passkeys/[id]/route.ts` |
| POST | `/api/profile/password` | `src/app/api/profile/password/route.ts` |
| POST | `/api/profile/password-reset-request` | `src/app/api/profile/password-reset-request/route.ts` |
| POST | `/api/profile/password-reset` | `src/app/api/profile/password-reset/route.ts` |
| GET | `/api/users` | `src/app/api/users/route.ts` |
| POST | `/api/users` | `src/app/api/users/route.ts` |
| GET | `/api/users/[id]` | `src/app/api/users/[id]/route.ts` |
| PUT | `/api/users/[id]` | `src/app/api/users/[id]/route.ts` |
| GET | `/api/users/[id]/avatar` | `src/app/api/users/[id]/avatar/route.ts` |
| POST | `/api/user/signature` | `src/app/api/user/signature/route.ts` |
| POST | `/api/user/avatar` | `src/app/api/user/avatar/route.ts` |
| POST | `/api/user/storage-recalc` | `src/app/api/user/storage-recalc/route.ts` |
| GET | `/api/mailboxes` | `src/app/api/mailboxes/route.ts` |
| POST | `/api/mailboxes` | `src/app/api/mailboxes/route.ts` |
| GET | `/api/mailboxes/[id]` | `src/app/api/mailboxes/[id]/route.ts` |
| PUT | `/api/mailboxes/[id]` | `src/app/api/mailboxes/[id]/route.ts` |
| DELETE | `/api/mailboxes/[id]` | `src/app/api/mailboxes/[id]/route.ts` |
| POST | `/api/mailboxes/[id]/test` | `src/app/api/mailboxes/[id]/test/route.ts` |
| POST | `/api/mailboxes/[id]/resync` | `src/app/api/mailboxes/[id]/resync/route.ts` |
| PUT | `/api/mailboxes/[id]/permissions` | `src/app/api/mailboxes/[id]/permissions/route.ts` |
| GET | `/api/mailboxes/[id]/permissions/list` | `src/app/api/mailboxes/[id]/permissions/list/route.ts` |
| GET | `/api/threads` | `src/app/api/threads/route.ts` |
| GET | `/api/threads/[id]` | `src/app/api/threads/[id]/route.ts` |
| POST | `/api/threads/[id]/assign` | `src/app/api/threads/[id]/assign/route.ts` |
| POST | `/api/threads/[id]/status` | `src/app/api/threads/[id]/status/route.ts` |
| POST | `/api/threads/[id]/read` | `src/app/api/threads/[id]/read/route.ts` |
| POST | `/api/threads/[id]/unread` | `src/app/api/threads/[id]/unread/route.ts` |
| POST | `/api/threads/[id]/hide` | `src/app/api/threads/[id]/hide/route.ts` |
| POST | `/api/threads/[id]/archive` | `src/app/api/threads/[id]/archive/route.ts` |
| POST | `/api/threads/[id]/delete` | `src/app/api/threads/[id]/delete/route.ts` |
| POST | `/api/threads/[id]/move` | `src/app/api/threads/[id]/move/route.ts` |
| POST | `/api/threads/[id]/mattermost/discuss` | `src/app/api/threads/[id]/mattermost/discuss/route.ts` |
| POST | `/api/threads/[id]/mattermost/forward` | `src/app/api/threads/[id]/mattermost/forward/route.ts` |
| POST | `/api/threads/[id]/mattermost/link` | `src/app/api/threads/[id]/mattermost/link/route.ts` |
| POST | `/api/messages/compose` | `src/app/api/messages/compose/route.ts` |
| POST | `/api/messages/[id]/reply` | `src/app/api/messages/[id]/reply/route.ts` |
| GET | `/api/messages/[id]/attachment/[attId]` | `src/app/api/messages/[id]/attachment/[attId]/route.ts` |
| GET | `/api/drafts` | `src/app/api/drafts/route.ts` |
| POST | `/api/drafts` | `src/app/api/drafts/route.ts` |
| GET | `/api/drafts/[id]` | `src/app/api/drafts/[id]/route.ts` |
| PUT | `/api/drafts/[id]` | `src/app/api/drafts/[id]/route.ts` |
| DELETE | `/api/drafts/[id]` | `src/app/api/drafts/[id]/route.ts` |
| GET | `/api/contacts` | `src/app/api/contacts/route.ts` |
| POST | `/api/contacts` | `src/app/api/contacts/route.ts` |
| GET | `/api/contacts/[id]` | `src/app/api/contacts/[id]/route.ts` |
| PUT | `/api/contacts/[id]` | `src/app/api/contacts/[id]/route.ts` |
| DELETE | `/api/contacts/[id]` | `src/app/api/contacts/[id]/route.ts` |
| GET | `/api/contacts/google/auth` | `src/app/api/contacts/google/auth/route.ts` |
| GET | `/api/contacts/google/callback` | `src/app/api/contacts/google/callback/route.ts` |
| POST | `/api/contacts/google/sync` | `src/app/api/contacts/google/sync/route.ts` |
| POST | `/api/push/subscribe` | `src/app/api/push/subscribe/route.ts` |
| GET | `/api/push/vapid-public-key` | `src/app/api/push/vapid-public-key/route.ts` |
| POST | `/api/push/test` | `src/app/api/push/test/route.ts` |
| GET | `/api/push/devices` | `src/app/api/push/devices/route.ts` |
| DELETE | `/api/push/devices/[id]` | `src/app/api/push/devices/[id]/route.ts` |
| GET | `/api/dashboard` | `src/app/api/dashboard/route.ts` |
| GET | `/api/admin/settings` | `src/app/api/admin/settings/route.ts` |
| PUT | `/api/admin/settings` | `src/app/api/admin/settings/route.ts` |
| POST | `/api/admin/settings/generate-vapid` | `src/app/api/admin/settings/generate-vapid/route.ts` |
| GET | `/api/admin/settings/vapid-public-key` | `src/app/api/admin/settings/vapid-public-key/route.ts` |
| GET | `/api/admin/audit-logs` | `src/app/api/admin/audit-logs/route.ts` |
| GET | `/api/admin/connection-errors` | `src/app/api/admin/connection-errors/route.ts` |
| GET | `/api/admin/notification-errors` | `src/app/api/admin/notification-errors/route.ts` |
| POST | `/api/admin/notification-errors/[id]/retry` | `src/app/api/admin/notification-errors/[id]/retry/route.ts` |
| GET | `/api/admin/users` | `src/app/api/admin/users/route.ts` |
| GET | `/api/cron/sync` | `src/app/api/cron/sync/route.ts` |

---

## 更新時チェック項目

- `route.ts` を追加・削除したらこの表を更新すること
- `docs/05_api.md` との整合性を確認すること
