# PWA・Push通知

> 最終更新: 2026-04-12

---

## PWA構成

| 要素 | ファイル | 内容 |
|---|---|---|
| Service Worker | `public/sw.js` | インストール・アクティベート・Push受信・通知クリック処理 |
| Web App Manifest | `public/manifest.webmanifest` | アプリ名・アイコン・テーマカラー・ショートカット |
| SW登録クライアント | `src/app/sw-client.tsx` | ブラウザ側でのSW登録・Push購読処理（`'use client'`） |
| Root Layout | `src/app/layout.tsx` | `<SWClient />` をマウントして登録を起動 |
| Next.js設定 | `next.config.js` | `/sw.js` に `Cache-Control: no-cache` + `Service-Worker-Allowed: /` ヘッダーを追加 |

---

## manifest.webmanifest の設定

**ファイル**: `public/manifest.webmanifest`

| 項目 | 値 |
|---|---|
| `name` | `"共有メールワークスペース"` |
| `display` | `"standalone"` |
| `theme_color` | `"#2563eb"` |
| アイコン | 192px (any, maskable), 512px (any, maskable) |
| ショートカット | `/threads`（メール一覧） |

---

## Service Worker の配置と役割

**ファイル**: `public/sw.js`

| イベント | 処理 |
|---|---|
| `install` | `skipWaiting()` — 即座に有効化 |
| `activate` | `clients.claim()` — 全ページを制御下に |
| `push` | 受信したPayloadから `notification.title`, `notification.body`, `notification.url` を取得し、`self.registration.showNotification()` で表示 |
| `notificationclick` | 通知URLを持つウィンドウが既に開いていればフォーカス。なければ `clients.openWindow(url)` で開く |

Push Payloadのフォーマット（`src/lib/push.ts` の `sendWebPushToUser()` から）:
```json
{
  "title": "通知タイトル",
  "body": "通知本文",
  "url": "/threads/cuid..."
}
```

通知タグ: `'mail-notification'`（重複防止）

---

## VAPID関連設定

Web Push には VAPID（Voluntary Application Server Identification）が必要。

| 項目 | 保存場所 | 内容 |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `app_settings` テーブル | base64url エンコードの公開鍵 |
| `VAPID_PRIVATE_KEY` | `app_settings` テーブル | base64url エンコードの秘密鍵 |
| `VAPID_SUBJECT` | `app_settings` テーブル | `mailto:admin@example.com` 形式 |

**鍵生成**: 管理画面 `/admin/settings` → 「VAPID鍵を生成」ボタン → `POST /api/admin/settings/generate-vapid`

**実装ファイル**: `src/lib/vapid.ts`（`generateVapidKeys()`）
- `web-push` ライブラリの `generateVAPIDKeys()` を使用
- ECDSA P-256 鍵ペアを生成

---

## 通知購読の流れ

```
1. ブラウザが /notifications ページを開く
2. src/app/sw-client.tsx がマウント
3. navigator.serviceWorker.register('/sw.js')
4. 通知許可を確認（Notification.permission）
5. GET /api/push/vapid-public-key で公開鍵を取得
6. pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
7. 取得した { endpoint, keys: { p256dh, auth } } を POST /api/push/subscribe に送信
8. push_subscriptions テーブルに upsert（endpoint で一意）
```

---

## 通知送信の流れ

```
新着メール受信（src/lib/mail/sync.ts）
  ↓
1. 対象ユーザーを決定
   - チームメール: mailbox_permissions の can_view=true の全ユーザー
   - 個人メール: mailbox.owner_user_id のユーザー
2. notification_events テーブルにレコード作成
3. sendWebPushToUser(userId, payload) を呼び出し（src/lib/push.ts）
   ↓
4. push_subscriptions から is_active=true の全購読を取得
5. 各購読に web-push.sendNotification() で送信
6. 410/404 エラーの場合は is_active=false に更新
```

---

## 関連API

| Method | Path | 役割 |
|---|---|---|
| POST | `/api/push/subscribe` | Push購読の登録/更新 |
| DELETE | `/api/push/subscribe` | Push購読の解除 |
| GET | `/api/push/devices` | 登録済みデバイス一覧 |
| DELETE | `/api/push/devices/[id]` | デバイス削除 |
| GET | `/api/push/vapid-public-key` | VAPID公開鍵取得（クライアント用） |
| GET | `/api/admin/settings/vapid-public-key` | VAPID公開鍵取得（管理者用） |
| POST | `/api/push/test` | テスト通知送信 |
| POST | `/api/admin/settings/generate-vapid` | VAPID鍵ペア生成 |

---

## ブラウザ依存の注意点

| 項目 | 内容 |
|---|---|
| Safari (iOS) | iOS 16.4以降でWeb Push対応。ホーム画面追加が必要な場合がある（要確認） |
| Firefox | Web Push対応。VAPID必須 |
| Chrome/Edge | 完全対応 |
| セキュリティコンテキスト | Web Push は HTTPS または localhost のみ動作 |
| 通知許可 | ユーザーの明示的な許可が必要。拒否後は再要求不可（ブラウザ設定から変更） |

---

## デバイス管理

- 各ブラウザ/デバイスの組み合わせが1つの `push_subscriptions` レコードに対応
- `endpoint` で一意管理（upsert）
- `platform`, `user_agent` を記録
- 使われなくなった購読は Push 送信時の 410/404 エラーで自動非活性化

---

## 更新時チェック項目

- Service Worker を変更した場合は `public/sw.js` を更新し、ブラウザのSWキャッシュをクリアして動作確認すること
- VAPID鍵を再生成した場合は全ユーザーのPush購読が無効になるため、再購読が必要になることをユーザーに通知すること
- Push Payload のフォーマットを変更した場合は `sw.js` と `src/lib/push.ts` の両方を更新すること
