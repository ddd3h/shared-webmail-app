# 付録: 依存パッケージ一覧

> 最終更新: 2026-04-12  
> ソースファイル: `package.json`

---

## 本番依存 (dependencies)

| パッケージ | バージョン | 用途 | 使用ファイル |
|---|---|---|---|
| `next` | ^16.2.3 | フレームワーク本体 | 全体 |
| `@prisma/client` | ^5.13.0 | PostgreSQL ORM クライアント | `src/lib/db.ts`, 各Route Handler |
| `iron-webcrypto` | ^0.10.1 | Cookie sealed session 暗号化 | `src/lib/auth.ts` |
| `imapflow` | ^1.0.164 | IMAP受信・操作 | `src/lib/mail/imap.ts`, `src/lib/mail/sync.ts` |
| `nodemailer` | ^8.0.5 | SMTP送信 | `src/lib/mail/smtp.ts`, `src/workers/send.ts` |
| `mailparser` | ^3.9.0 | 受信メールの解析（MIMEパース） | `src/lib/mail/sync.ts` |
| `web-push` | ^3.6.6 | VAPID/Web Push通知送信 | `src/lib/push.ts` |
| `@simplewebauthn/browser` | ^13.3.0 | WebAuthn（パスキー）クライアント | `src/app/login/LoginForm.tsx` |
| `@simplewebauthn/server` | ^13.3.0 | WebAuthn（パスキー）サーバー検証 | `src/app/api/passkeys/*/route.ts` |
| `zod` | ^3.23.8 | リクエストバリデーション | 各Route Handler |
| `cookie` | ^1.1.1 | Cookie パース（用途要確認） | 要確認 |

---

## 開発依存 (devDependencies)

| パッケージ | バージョン | 用途 |
|---|---|---|
| `typescript` | ^5.4.5 | TypeScript言語 |
| `prisma` | ^5.13.0 | Prisma CLI（migrate, generate） |
| `tailwindcss` | ^3.4.19 | CSSフレームワーク |
| `postcss` | ^8.5.9 | CSSポストプロセッサ |
| `autoprefixer` | ^10.4.27 | ベンダープレフィックス自動付与 |
| `ts-node` | ^10.9.2 | TypeScriptのWorker直接実行 |
| `vitest` | ^4.1.4 | テストランナー |
| `@vitejs/plugin-react` | ^4.3.4 | Vitest用Reactプラグイン |
| `jsdom` | ^26.0.0 | テスト用ブラウザ環境シミュレーション |
| `@testing-library/react` | ^16.2.0 | コンポーネントテスト |
| `@testing-library/jest-dom` | ^6.6.3 | DOM状態検証用マッチャー |
| `@testing-library/user-event` | ^14.6.1 | ユーザー操作シミュレーション |
| `@types/node` | ^20.12.7 | Node.js型定義 |
| `@types/react` | ^18.2.79 | React型定義 |
| `@types/react-dom` | ^18.2.25 | React DOM型定義 |
| `@types/nodemailer` | ^8.0.0 | nodemailer型定義 |
| `@types/mailparser` | ^3.4.6 | mailparser型定義 |
| `@types/web-push` | ^3.6.4 | web-push型定義 |

---

## 注意事項

- `react` / `react-dom` が `dependencies` に存在しない（`next` に内包されている可能性、要確認）
- `cookie` パッケージの具体的な使用箇所は要確認

---

## 更新時チェック項目

- `package.json` を更新したら本ドキュメントの表を更新すること
- 新しいパッケージを追加した場合は「用途」と「使用ファイル」を必ず記載すること
