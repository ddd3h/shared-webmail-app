# キャッシュの考え方（Next.js 16 の Cache Components）

`next.config.js` で `cacheComponents: true` / `partialPrefetching: true` を有効にしています。**「何も書かなければキャッシュされない」**のが基本で、キャッシュしたいものだけ、コードの中で明示します。

## 決まり

| やりたいこと | 書き方 |
|---|---|
| 結果を一定時間使い回す | 関数の先頭に `'use cache'`。`cacheLife(...)` で期間を必ず書く |
| 手動で捨てたい | `cacheTag('名前')` を付け、変更時に `revalidateTag('名前', { expire: 0 })`（Route Handler / Server Action から） |
| ログイン情報（Cookie・ヘッダー）に依存する処理 | キャッシュしない。必要な値（ユーザーIDなど）を**引数で渡して**キャッシュ関数を呼ぶ |
| 画面の一部がリクエストごとに変わる | その部分を `<Suspense>` で包む（それ以外は先に用意される） |
| `Date.now()`・乱数をサーバーの画面で使う | `await connection()` の後で使う（クライアントコンポーネントなら不要） |

`export const dynamic / revalidate / fetchCache / runtime` は使えません（書くとビルドエラー）。`fetch` も既定ではキャッシュされません。

キャッシュに入れられるのは**単純なデータ**（文字列・数値・オブジェクト・配列・Date など）だけです。`Buffer` は入れられないので、画像は base64 の文字列にして保存し、取り出すときに戻します。

## このアプリでキャッシュしているもの

| 対象 | 場所 | 期間 | 捨てるとき |
|---|---|---|---|
| 送信者アイコン（BIMI → favicon → Gravatar） | `src/lib/sender-icon.ts` | 見つかった: 1日（古くなっても裏で更新しつつ表示）／見つからない: 6時間 | 期限のみ（タグ `sender-icons`） |
| プロフィール画像（Mattermost） | `src/lib/avatar.ts` | 見つかった: 1日／なし: 5分 | Mattermost IDの変更時（`forgetAvatar`）。ログアウトでは捨てない |

### 再起動しても残す（DB の `image_cache`）

この2つは、メモリ（`'use cache'`）の後ろに DB のテーブル `image_cache` を置いています（`src/lib/image-store.ts`）。読む順番は **メモリ → DB → 外部（Mattermost・インターネット）** です。デプロイや再起動でメモリが空になっても、DB から返すので、全員の画像を取り直しに行きません。

- 上の表の期間を過ぎたら取り直します。取り直しに**失敗**したとき（相手が落ちている・時間切れ・5xx）は、古い画像を出し続け、5分後にまた試します。相手が「画像はない」と答えたとき（404 など）は、古い画像を消します。
- プロフィール画像の行には、どの Mattermost ユーザーのために取ったか（`owner`）を残します。Mattermost ID がどこで変わっても、前の人の画像は出ません。社員を消すと、その人の行も消えます（外部キーの cascade）。
- 送信者アイコンは、アドレス・ドメインそのものではなく **sha256 のハッシュ**を鍵にします（誰とやり取りしているかを表に残さない）。
- 30日間取り直していない行は、1日1回消します（`pruneImageCache`、`src/instrumentation.node.ts`）。
- ブラウザには ETag を付けて返し、同じ画像なら 304（中身なし）で済ませます。304 も、ログイン中（IP アドレスの本人確認も済み）の人にしか返しません。

ログアウトで捨てないのは、画像がログインごとではなく**画像の持ち主ごと**に保存されていて、ログインしている人なら誰でも見られるものだからです。捨てても守りは強くなりません。

以前は、どちらも自前でファイル（`storage/avatars/`・`storage/sender-icons/`）に保存し、期限を自分で数えていました。それはやめています（古い `storage/` の中身は使われません。消して構いません）。

> メモリのキャッシュは**プロセスのメモリ**に入ります（セルフホストなら全リクエストで共有）。再起動すると空になり、次のアクセスで DB（上記の2つ）か元から取り直します。

## キャッシュしないもの（理由つき）

- **API（`/api/*`）**: どれもログイン中の本人のデータを返すので、サーバー側でも共有キャッシュしません。ブラウザ側は `Cache-Control: no-store` などで制御（`next.config.js` の `headers()`）。
- **セキュリティの設定・ブロック一覧**（`security-settings.ts`・`ip-block.ts`）: `proxy.ts`（全リクエストの入口）から呼ばれ、変更をすぐ反映する必要があるため、数秒だけ覚える自前のキャッシュを残しています（`SECURITY_CACHE_TTL_MS`）。
- **未読数・メール一覧・ToDo**: 画面側（SWR）が持ち、変更のたびに取り直します（`src/lib/unread-client.ts`）。

## 画面の組み立て

- 上のメニュー（`Nav`）は現在のURLを読むため、`src/app/(app)/layout.tsx` で `<Suspense>` に入れています。ほかの部分はそのまま先に用意されます。
- GoogleのOAuthコールバック（`/api/calendar/google/callback`・`/api/contacts/google/callback`）は、Cookieを `try/catch` の中で読むため、先頭で `await connection()` を呼んで必ずリクエスト時に実行します。

## 開発時の注意

- 画面の表示がブロックされる箇所は、開発中に画面の左下の通知（insight）とサーバーのログに出ます。
- キャッシュ関数の中で `cookies()` / `headers()` を読むとエラーになります。引数で渡してください。
- 参考: `node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md`
