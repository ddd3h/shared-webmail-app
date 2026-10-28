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
| **E2Eテスト** | 主要なユーザーストーリー（認証・ナビ・カレンダー・勤怠給与・経費・出張・全銀振込）。実ブラウザ＋実DB | Playwright | `e2e/` （[実行方法](#e2eテストの実行)） |

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


### E2Eテストの実行

```bash
npm run test:e2e                         # 全部（PC + モバイル）
npx playwright test e2e/transfers.spec.ts --project=desktop   # 1ファイルだけ
npm run test:e2e:report                  # 失敗時のレポート（スクショ・トレース）
```

- PostgreSQL（既定 `localhost:5433`、`E2E_DATABASE_URL` で変更可）に専用DB `webmail_e2e` を作り、`prisma db push --force-reset` で毎回作り直します。**開発用DBには触りません**。
- `next dev` をポート3100で自動起動し、Mattermostはモックサーバー（8065）に向けます（実際には送信されません）。
- ログインは最初に1回ずつAPIで行い、役割別のセッションを `e2e/.auth/` に保存して使い回します（管理者・副管理者・従業員・業務委託・役員・一般・経理担当）。
- 1つのDBを共有するため `workers=1`。各specが使うテーブルは `beforeAll`/`beforeEach` で初期化します。
- 開発サーバーの「N」バッジはモバイルの下部バーへのクリックを妨げるため、テスト中は非表示にしています（本番ビルドには存在しません）。
