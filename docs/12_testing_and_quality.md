# テスト・品質

> 最終更新: 2026-04-12

---

## テスト構成

本プロジェクトでは **Vitest** を中心とした多層的なテスト構成を採用しています。

### テストの種類と対象

| 分類 | 対象 | ツール | ディレクトリ |
|---|---|---|---|
| **ユニットテスト** | 純粋なロジック（暗号化、正規化、スレッド統合） | Vitest | `tests/unit/`, `tests/*.test.ts` |
| **APIテスト** | Route Handlers (バリデーション、認可、DB副作用) | Vitest + Mock Prisma | `tests/api/` |
| **コンポーネントテスト** | Reactコンポーネント (UI、インタラクション) | RTL + jsdom | `tests/components/` |
| **E2Eテスト** | 主要なユーザーストーリー (未実装) | Playwright (推奨) | - |

### 主要なテストファイル

| ファイル | 内容 |
|---|---|
| `tests/api/users-update.test.ts` | **回帰テスト**: ユーザー更新（mattermost_user_id等）の検証 |
| `tests/api/auth-login.test.ts` | ログインAPI、セッションクッキー発行の検証 |
| `tests/components/LoginForm.test.tsx` | ログイン画面の入力・エラー表示の検証 |
| `tests/unit/threading.test.ts` | スレッド統合ロジック（In-Reply-To等）の検証 |
| `tests/api/mailboxes.test.ts` | メールボックス作成・権限の検証 |
| `tests/api/messages-reply.test.ts` | 返信API、送信ジョブ作成の検証 |
| `tests/api/push.test.ts` | Web Push購読登録・解除の検証 |
| `tests/rbac.test.ts` | RBAC（権限チェック）ユーティリティの検証 |
| `tests/crypto.test.ts` | AES-GCM 暗号化/復号の検証 |

---

## 使用ツール

- **Vitest**: テストランナー
- **@testing-library/react (RTL)**: コンポーネントテスト用
- **jsdom**: ブラウザ環境のシミュレーション
- **Mocking**: `vi.mock` を使用して Prisma や外部 API (fetch), FS をモック

---

## テスト実行コマンド

```bash
# 全テスト実行
npm run test

# 型チェックのみ実行
npm run typecheck

# 静的解析（Lint）を実行
npm run lint

# ウォッチモード
npm run test:watch

# 特定のファイルのみ実行
npx vitest tests/api/users-update.test.ts
```

---

## Vitest 設定

**ファイル**: `vitest.config.ts`, `tests/setup.ts`

- **globals**: `true` (jest-dom 等との互換性のため)
- **environment**: `jsdom`
- **path alias**: `@/` → `src/`

---

## カバレッジ

カバレッジを取得する場合:
```bash
# カバレッジの出力（実行には @vitest/coverage-v8 が必要）
npx vitest run --coverage
```

---

## 品質担保のガイドライン

1.  **回帰防止**: 過去に不具合が発生した箇所には必ず回帰テスト（API/Unit）を追加すること。
2.  **1テスト1責務**: 1つのテストケースで複数のパスを検証せず、失敗時に原因が特定できる粒度にする。
3.  **モックの範囲**: 原則として Prisma Client や外部 API はモックするが、ロジック自体は極力モックせず実コードを動かす。
4.  **認可の検証**: 更新系 API を追加した場合は、必ず「管理者以外による拒否」のケースを含めること。
