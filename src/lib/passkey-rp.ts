// WebAuthn Relying Party configuration
// requestOrigin: リクエストの Origin ヘッダー値。渡された場合はそこから rpID/origin を導出し
//                ngrok 等の任意ホストからのアクセスにも対応する。省略時は NEXT_PUBLIC_APP_URL を使用。
export function getRpConfig(requestOrigin?: string | null) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // In production only the app's own address may act as the relying party (unless explicitly opened up for tunnels like ngrok).
  const sameAsApp = (() => { try { return !!requestOrigin && new URL(requestOrigin).host === new URL(appUrl).host; } catch { return false; } })();
  const strict = process.env.NODE_ENV === 'production' && process.env.PASSKEY_ALLOW_ANY_ORIGIN !== '1';

  if (requestOrigin && (sameAsApp || !strict)) {
    const url = new URL(requestOrigin);
    return {
      rpName: '共有メールワークスペース',
      rpID: url.hostname,
      origin: requestOrigin.replace(/\/$/, ''),
    };
  }

  const url = new URL(appUrl);
  return {
    rpName: '共有メールワークスペース',
    rpID: url.hostname,
    origin: appUrl.replace(/\/$/, ''),
  };
}
