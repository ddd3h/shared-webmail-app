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
| プロフィール画像（Mattermost） | `src/lib/avatar.ts` | 見つかった: 1日／なし・取得失敗: 5分 | ログアウト時・Mattermost IDの変更時（`forgetAvatar`） |

以前は、どちらも自前でファイル（`storage/avatars/`・`storage/sender-icons/`）に保存し、期限を自分で数えていました。それをやめ、期限と破棄の方法を上の表のとおり1か所に書いています（古い `storage/` の中身は使われません。消して構いません）。

> キャッシュは**プロセスのメモリ**に入ります（セルフホストなら全リクエストで共有）。再起動すると空になり、次のアクセスで取り直します。

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
