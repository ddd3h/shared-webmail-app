# プロフィール（個人情報・受取口座・セキュリティ・メール）

`/profile` に、自分に関することを1か所にまとめています。

| グループ | 項目 | 内容 |
|---|---|---|
| 個人情報と口座 | **個人情報** | 名前・メールアドレス・区分（役員/正社員/パート/派遣/従業員/業務委託）・所属・役職・システムの権限・Mattermost連携。**表示のみ**で、変更は管理者が行う（`GET /api/profile/info`） |
| | **自宅** | 自家用車の経費（走行距離）の起点になる住所。本人・経理担当・システム管理者だけが見られる（`GET/PUT /api/profile/home`。監査ログに住所は残さない）。詳しくは `19_expenses.md` |
| | **受取口座** | 給与・報酬・立替金の振込先（全銀データに使える形式）。経理担当が確認すると振込の対象になる。`/profile#bank` で直接開ける（スマホでは折りたたみが自動で開く） |
| ログインとセキュリティ | パスワード変更 / パスキー / 2段階認証 / ログイン中の端末と履歴 | [24_security.md](24_security.md) |
| メール | メールアカウント / メール署名 | 割り当てられたアカウントの同期・接続テスト、返信に入れる署名 |

- 以前は「勤怠・給与」の中の「受取口座」タブにありました。いまは勤怠・給与の「給与明細」に、プロフィールへのリンクだけがあります。通知（口座が確認されたDM）のリンクも `/profile#bank` です。
- 口座番号は暗号化して保存し、本人と経理担当・管理者だけが見られます（[22_zengin_transfers.md](22_zengin_transfers.md)）。
- スマホでは、個人情報だけ開いた状態で、ほかは見出しをタップして開きます（[27_mobile.md](27_mobile.md)）。

実装: `src/app/(app)/profile/page.tsx`、`src/components/profile/PersonalInfoSection.tsx`・`BankAccountSection.tsx`、`src/app/api/profile/info/route.ts`。テスト: `e2e/profile.spec.ts`、`e2e/transfers.spec.ts`・`e2e/transfers.mobile.spec.ts`（口座の登録）。

## これから

住所・電話番号・緊急連絡先などの項目を増やす場合は、`users` に列を足して `PersonalInfoSection` に出す（本人が編集できる項目と、管理者だけが変えられる項目を分ける）。
