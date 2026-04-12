# 認証・セッション・セキュリティ

> 最終更新: 2026-04-12

---

## 認証方式の概要

本システムは2種類の認証方式をサポートする。

| 方式 | 実装 | 説明 |
|---|---|---|
| パスワード認証 | `POST /api/auth/login` | メールアドレス + scryptハッシュ検証 |
| パスキー認証 | `POST /api/passkeys/auth` | WebAuthn (FIDO2) — Touch ID / Face ID / セキュリティキー |

---

## セッション方式の概要

**iron-webcrypto** を使用した sealed cookie セッション。

- セッション情報をサーバー側に保存しない（ステートレス）
- セッションデータをAEAD暗号化してCookieに格納
- Cookie名: `sid`
- 有効期限: **30分の非アクティビティタイムアウト**（スライディングウィンドウ）
- `src/lib/auth.ts` に実装

---

## iron-webcrypto の利用箇所

**ファイル**: `src/lib/auth.ts`

```typescript
import * as Iron from 'iron-webcrypto';

const cryptoImpl: any = globalThis.crypto; // Web Crypto API
const password = { id: '1', secret: process.env.SESSION_SECRET };

// シール（暗号化）
Iron.seal(cryptoImpl, session, password, { ...Iron.defaults, ttl: 0 })

// アンシール（復号）
Iron.unseal(cryptoImpl, token, { '1': password }, { ...Iron.defaults, ttl: 0 })
```

`ttl: 0` はライブラリ側のTTL無効。アプリ側で `lastActivity` フィールドを使ったタイムアウト管理を行う。

---

## cookie sealed session の流れ

```
ログイン成功
  → Session オブジェクト生成: { userId, email, role, lastActivity: Date.now() }
  → Iron.seal() でAEAD暗号化 → base64文字列
  → Set-Cookie: sid=<token>; HttpOnly; SameSite=Lax; Max-Age=1800; Path=/

後続リクエスト（Middleware）
  → Cookie: sid=<token>
  → Iron.unseal() で復号
  → lastActivity チェック（30分以内か）
  → 有効なら session.lastActivity を更新してCookieを再発行
  → 期限切れなら sid Cookie を削除して /login にリダイレクト
```

---

## Cookie 属性

`src/lib/auth.ts` の `COOKIE_OPTIONS` より:

| 属性 | 値 | 備考 |
|---|---|---|
| `httpOnly` | `true` | JavaScript からアクセス不可 |
| `sameSite` | `'lax'` | CSRF対策（ただし Lax は完全ではない） |
| `path` | `'/'` | 全パスで送信 |
| `maxAge` | `1800`（秒） | 30分。スライディングウィンドウで更新 |
| `secure` | 未設定（要確認） | **本番環境では `true` にすることを推奨** |

> **要確認**: `secure` 属性が設定されていない。本番（HTTPS）環境では必ず設定すること。

---

## ログイン・ログアウト・セッション確認フロー

### ログイン (`POST /api/auth/login`)

1. リクエストボディから `email`, `password` を取得
2. `prisma.users.findUnique({ where: { email } })` でユーザー検索
3. `verifyPassword(password, user.password_hash)` でscryptハッシュ比較
4. 一致したら `setSessionCookie(res, { userId, email, role })` でCookieセット
5. `{ ok: true }` を返す

### ログアウト (`POST /api/auth/logout`)

1. レスポンスで `sid` Cookieを削除
2. `{ ok: true }` を返す

### セッション確認 (`GET /api/auth/session`)

1. `getSession()` でセッション取得
2. 未認証なら `{ error: 'unauthorized' }` (401)
3. 認証済みなら `{ userId, email, role }` を返す

---

## Middleware による制御

**ファイル**: `src/middleware.ts`（Edge runtime）

処理順序:

1. 公開パスとスタティックアセットは通過（`PUBLIC_PATHS`, `_next/`, `sw.js`, `manifest`, `icons/`, `favicon.ico`）
2. `getSessionFromRequest(req)` でEdge互換のセッション取得（`req.cookies.get('sid')`を使用）
3. 未認証: ページは `/login?from=<元パス>` にリダイレクト、APIは 401 JSON返却
4. 管理者専用パス (`/admin/*`, `/api/admin/*`): `session.role !== 'admin'` なら 403/リダイレクト
5. 有効セッション: `refreshSessionCookie()` でスライディングウィンドウ更新

**重要**: Middleware は Edge runtime のため `prisma` や Node.js API（`require('crypto')`等）は使用不可。`globalThis.crypto`（Web Crypto API）を使用。

---

## 認可の考え方（RBAC）

**ファイル**: `src/lib/rbac.ts`

3つの権限チェック関数:

| 関数 | 説明 | バイパス条件 |
|---|---|---|
| `canViewMailbox(userId, mailboxId)` | 閲覧権限 | admin全体 or owner or team_member（team mailboxのみ）or `can_view=true`レコード |
| `canReplyMailbox(userId, mailboxId)` | 返信権限 | admin全体 or owner or `can_reply=true`レコード |
| `canAssignMailbox(userId, mailboxId)` | 担当変更権限 | admin全体 or `can_assign=true`レコード（ownerバイパスなし） |

**権限チェック階層**（高い順）:
1. `session.role === 'admin'` → 全権限バイパス
2. `mailbox.owner_user_id === userId` → `canViewMailbox`, `canReplyMailbox` でバイパス
3. `team_members` 所属 → `canViewMailbox` のみバイパス（team mailboxのみ）
4. `mailbox_permissions` テーブルの明示的レコード

---

## パスワードハッシュ

**ファイル**: `src/lib/password.ts`

- **アルゴリズム**: scrypt（Node.js組み込み）
- **パラメータ**: N=2^14, r=8, p=1, dkLen=64バイト
- **フォーマット**: `scrypt$N$r$dklen$<base64_salt>$<base64_hash>`
- **比較**: `crypto.timingSafeEqual()` でタイミング攻撃対策

---

## 暗号化対象データ

| 対象 | 暗号化方式 | 実装箇所 |
|---|---|---|
| IMAPパスワード | AES-256-GCM | `src/lib/crypto.ts` |
| SMTPパスワード | AES-256-GCM | `src/lib/crypto.ts` |
| Google OAuthトークン | AES-256-GCM（推定、要確認） | `src/lib/crypto.ts` |
| セッション情報 | AEAD（iron-webcrypto） | `src/lib/auth.ts` |

---

## AES-256-GCM の利用箇所

**ファイル**: `src/lib/crypto.ts`

```typescript
// 暗号化
async function encrypt(text: string): Promise<string>
// → 12バイトランダムIVを生成
// → AES-GCM (256bit) で暗号化
// → base64(IV + 暗号文) として返す

// 復号
async function decrypt(b64: string): Promise<string>
// → base64デコード
// → 先頭12バイトをIVとして分離
// → AES-GCM で復号
```

- **鍵**: `ENCRYPTION_KEY_HEX` 環境変数から取得（32バイト = 64桁の16進文字列）
- **IV**: 毎回ランダム生成（12バイト）
- **鍵バージョン**: `mailbox_credentials.encryption_key_version` で追跡

---

## セキュリティ上の注意点

1. **`SESSION_SECRET` の強度**: 32文字以上のランダム文字列が必須。弱い値だとセッション偽造が可能。
2. **`ENCRYPTION_KEY_HEX` の管理**: これが漏洩すると全メールパスワードが復号可能になる。環境変数は安全に管理すること。
3. **Cookie の `secure` 属性**: コード上で明示設定されていない（**要確認・要対応**）。本番HTTPS環境では必ず `secure: true` を追加すること。
4. **鍵ローテーション**: `ENCRYPTION_KEY_HEX` を変更すると既存の暗号化データが復号不能になる。ローテーション手順は未実装（要確認）。
5. **パスキー**: `@simplewebauthn/server` v13を使用。チャレンジはセッション or DBに保存（実装詳細は要確認）。
6. **CSRF対策**: `sameSite: 'lax'` を設定しているが、完全なCSRF対策には不十分なケースがある（要確認）。
7. **レート制限**: ログイン試行のレート制限が実装されていない（**要確認・リスク**）。ブルートフォース攻撃に対して脆弱な可能性がある。

---

## 既知のリスク

| リスク | 深刻度 | 状況 |
|---|---|---|
| Cookie `secure` 属性未設定 | 中 | 本番HTTPS環境では必ず設定が必要 |
| ログイン試行のレート制限なし | 中〜高 | コード上で確認できない |
| セッション無効化（ログアウト以外） | 低〜中 | Cookie削除のみ。パスワード変更時等の即時無効化は未実装（推定） |
| 鍵ローテーション手順なし | 中 | `ENCRYPTION_KEY_HEX` 変更時のマイグレーション手順が不明 |

---

## WebAuthn（パスキー）の実装

**関連ファイル**:
- `src/app/api/passkeys/register-options/route.ts` — 登録チャレンジ生成
- `src/app/api/passkeys/register/route.ts` — 登録完了
- `src/app/api/passkeys/auth-options/route.ts` — 認証チャレンジ生成
- `src/app/api/passkeys/auth/route.ts` — 認証完了
- `src/app/login/LoginForm.tsx` — クライアント側（`startAuthentication()`）

チャレンジのストレージ方法（セッションCookie or DB）は要確認。

---

## 更新時チェック項目

- Cookie属性を変更した場合は「Cookie属性」表を更新すること
- 認可ロジックを変更した場合は「認可の考え方」節を更新すること
- 新たなセキュリティリスクが判明した場合は「既知のリスク」表に追記すること
