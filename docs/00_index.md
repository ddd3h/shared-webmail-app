# 共有メールワークスペース — ドキュメント索引

> 最終更新: 2026-04-12  
> 対象リポジトリ: `webmail-app`  
> 対象ブランチ: main（作成時点）

---

## 目次

| ファイル | タイトル | 内容概要 |
|---|---|---|
| [01_overview.md](./01_overview.md) | プロジェクト概要 | 目的・アーキテクチャ・技術スタック・データフロー |
| [02_directory_structure.md](./02_directory_structure.md) | ディレクトリ構成 | 主要ディレクトリの責務・配置ルール |
| [03_frontend.md](./03_frontend.md) | フロントエンド | 画面一覧・App Router構成・状態管理 |
| [04_backend.md](./04_backend.md) | バックエンド | Route Handlers構成・サーバー責務分離 |
| [05_api.md](./05_api.md) | API仕様 | 全エンドポイント一覧・リクエスト/レスポンス詳細 |
| [06_database.md](./06_database.md) | データベース | Prismaスキーマ・全モデル定義・ER図 |
| [07_auth_session_security.md](./07_auth_session_security.md) | 認証・セッション・セキュリティ | iron-webcrypto・AES-GCM・RBAC |
| [08_email_integration.md](./08_email_integration.md) | メール連携 | IMAP受信・SMTP送信・スレッド統合 |
| [09_pwa_push.md](./09_pwa_push.md) | PWA・Push通知 | Service Worker・VAPID・購読フロー |
| [10_environment_variables.md](./10_environment_variables.md) | 環境変数 | 全変数一覧・必須/任意・使用箇所 |
| [11_setup_run_deploy.md](./11_setup_run_deploy.md) | セットアップ・起動・デプロイ | ローカル起動手順・本番ビルド |
| [12_testing_and_quality.md](./12_testing_and_quality.md) | テスト・品質 | Vitest・lint・型チェック |
| [13_known_issues_and_todos.md](./13_known_issues_and_todos.md) | 既知の課題・TODO | 未実装箇所・リスク・優先度 |
| [14_change_guide.md](./14_change_guide.md) | 変更ガイド | 画面追加・API追加・DB変更時の手順 |
| [15_draft_saving.md](./15_draft_saving.md) | 下書き保存機能 | デバウンス保存の仕組み・コラボ連携・既知バグ一覧 |

### 付録

| ファイル | 内容 |
|---|---|
| [appendix_routes_inventory.md](./appendix_routes_inventory.md) | 全APIルートとファイルパス対照表 |
| [appendix_schema_reference.md](./appendix_schema_reference.md) | Prismaモデル詳細リファレンス |
| [appendix_dependencies.md](./appendix_dependencies.md) | 依存パッケージ一覧・用途 |

---

## 既存ドキュメント（本ドキュメント群とは別に存在）

| ファイル | 内容 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 旧アーキテクチャ概要（本ドキュメント群作成前から存在） |
| [API_SURFACE.md](./API_SURFACE.md) | 旧APIサーフェス一覧（本ドキュメント群作成前から存在） |

> これらは上書きしていない。内容が古い場合は `docs/01_overview.md` および `docs/05_api.md` を参照すること。

---

## 最初に読むべき順番

1. **[01_overview.md](./01_overview.md)** — システム全体像の把握（必読）
2. **[02_directory_structure.md](./02_directory_structure.md)** — コード配置の理解
3. **[06_database.md](./06_database.md)** — データモデルの把握（改修前必読）
4. **[07_auth_session_security.md](./07_auth_session_security.md)** — 認証・権限の理解
5. **[05_api.md](./05_api.md)** — 実装済みAPIの全量把握
6. **[08_email_integration.md](./08_email_integration.md)** — メール処理の詳細
7. **[11_setup_run_deploy.md](./11_setup_run_deploy.md)** — ローカル環境の構築

---

## 変更時に更新すべきドキュメント一覧

| 変更内容 | 更新すべきドキュメント |
|---|---|
| 新規API追加 | 05_api.md、appendix_routes_inventory.md |
| DBスキーマ変更 | 06_database.md、appendix_schema_reference.md |
| 新規画面追加 | 03_frontend.md |
| 認証・権限ロジック変更 | 07_auth_session_security.md |
| 環境変数追加 | 10_environment_variables.md |
| メール処理変更 | 08_email_integration.md |
| Push通知変更 | 09_pwa_push.md |
| デプロイ手順変更 | 11_setup_run_deploy.md |
| 依存パッケージ追加/変更 | appendix_dependencies.md |

---

## 更新時チェック項目

- 各 `.md` の先頭に最終更新日を記載すること
- 実装と乖離したドキュメントが生まれた場合は「要確認」または「2026-XX-XX 時点では未更新」と明記すること
- 推測で内容を埋めないこと
