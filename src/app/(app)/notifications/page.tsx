'use client';
import { useEffect, useState } from 'react';

type DeviceInfo = {
  id: string;
  platform: string;
  user_agent: string;
  is_active: boolean;
  last_seen_at: string;
  created_at: string;
};

type InstallState = 'not-supported' | 'already-installed' | 'ios-safari' | 'ios-other' | 'android-chrome' | 'desktop' | 'installed';

function detectInstallState(): InstallState {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isAndroid = /Android/.test(ua);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;

  if (isStandalone) return 'already-installed';

  if (isIOS) {
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    return isSafari ? 'ios-safari' : 'ios-other';
  }
  if (isAndroid) return 'android-chrome';
  return 'desktop';
}

function getIOSVersion(): number | null {
  const match = navigator.userAgent.match(/OS (\d+)_/);
  return match ? parseInt(match[1], 10) : null;
}

export default function NotificationsPage() {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [vapidConfigured, setVapidConfigured] = useState(false);
  const [notifSupported, setNotifSupported] = useState<boolean | null>(null);
  const [installState, setInstallState] = useState<InstallState | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const state = detectInstallState();
    setInstallState(state);
    setNotifSupported('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window);
    if ('Notification' in window) setPermission(Notification.permission);
    fetchDevices();
    checkVapid();

    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function checkVapid() {
    const res = await fetch('/api/push/vapid-public-key').catch(() => null);
    setVapidConfigured(!!res?.ok);
  }

  async function fetchDevices() {
    const res = await fetch('/api/push/devices').catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setDevices(data.devices || []);
    }
  }

  async function requestPermissionAndSubscribe() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setMessage({ type: 'error', text: 'このブラウザはプッシュ通知に対応していません。' });
      return;
    }
    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setMessage({ type: 'error', text: '通知の許可が得られませんでした。ブラウザの設定から許可してください。' });
        return;
      }
      const res = await fetch('/api/push/vapid-public-key').catch(() => null);
      if (!res?.ok) {
        setMessage({ type: 'error', text: 'サーバーのVAPID設定が完了していません。管理者に確認してください。' });
        return;
      }
      const { publicKey } = await res.json();
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey
      });
      const sub = subscription.toJSON();
      const postRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
          platform: /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
            : /Android/.test(navigator.userAgent) ? 'android' : 'desktop',
          userAgent: navigator.userAgent
        })
      });
      if (postRes.ok) {
        setMessage({ type: 'success', text: 'プッシュ通知を有効にしました！' });
        await fetchDevices();
      } else {
        setMessage({ type: 'error', text: 'サブスクリプションの登録に失敗しました。' });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: `エラー: ${e?.message || String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function unsubscribe() {
    setLoading(true);
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint })
          });
          await sub.unsubscribe();
        }
      }
      setPermission('default');
      setMessage({ type: 'success', text: 'このデバイスのプッシュ通知を無効にしました。' });
      await fetchDevices();
    } catch (e: any) {
      setMessage({ type: 'error', text: `エラー: ${e?.message || String(e)}` });
    } finally {
      setLoading(false);
    }
  }

  async function sendTestPush() {
    setLoading(true);
    const res = await fetch('/api/push/test', { method: 'POST' });
    setLoading(false);
    if (res.ok) {
      setMessage({ type: 'success', text: 'テスト通知を送信しました。数秒後に通知が届きます。' });
    } else {
      setMessage({ type: 'error', text: 'テスト通知の送信に失敗しました。VAPIDキーの設定を確認してください。' });
    }
  }

  async function removeDevice(id: string) {
    const res = await fetch(`/api/push/devices/${id}`, { method: 'DELETE' });
    if (res.ok) setDevices(d => d.filter(dev => dev.id !== id));
  }

  async function triggerAndroidInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallState('already-installed');
      setDeferredPrompt(null);
    }
  }

  function platformLabel(platform: string) {
    if (platform === 'ios') return 'iOS';
    if (platform === 'android') return 'Android';
    return 'デスクトップ';
  }

  function platformIcon(platform: string) {
    if (platform === 'ios' || platform === 'android') return (
      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
    return (
      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  }

  const permissionStatus = () => {
    if (permission === 'granted') return { label: '有効', color: 'text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500' };
    if (permission === 'denied') return { label: 'ブロック済み', color: 'text-red-700 bg-red-50', dot: 'bg-red-500' };
    return { label: '未設定', color: 'text-gray-600 bg-gray-100', dot: 'bg-gray-400' };
  };

  const status = permissionStatus();
  const iosVersion = installState?.startsWith('ios') ? getIOSVersion() : null;
  const iosTooOld = iosVersion !== null && iosVersion !== null && iosVersion < 16;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-900">通知・インストール設定</h1>

      {message && (
        <div className={`p-4 rounded-xl text-sm flex items-start gap-3 ${
          message.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <span className="flex-shrink-0 mt-0.5">{message.type === 'success' ? '✓' : '!'}</span>
          <span className="flex-1">{message.text}</span>
          <button onClick={() => setMessage(null)} className="flex-shrink-0 text-current opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Install guide */}
      {installState && installState !== 'already-installed' && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">ホーム画面に追加</h2>

          {installState === 'ios-safari' && (
            <div className="space-y-3">
              {iosTooOld && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  iOS 16以降でプッシュ通知が利用できます（現在のiOSバージョン: {iosVersion}）。
                </div>
              )}
              <p className="text-sm text-gray-600">iPhoneでプッシュ通知を受け取るには、まずホーム画面に追加してください。</p>
              <ol className="space-y-2 text-sm text-gray-700">
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                  <span>Safariの下部にある「共有」ボタン（四角から矢印が出ているアイコン）をタップ</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                  <span>「ホーム画面に追加」をタップ</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">3</span>
                  <span>右上の「追加」をタップして完了</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">4</span>
                  <span>ホーム画面のアイコンからアプリを開き、この画面で通知を有効にする</span>
                </li>
              </ol>
            </div>
          )}

          {installState === 'ios-other' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              iOSでプッシュ通知を利用するには、<strong>Safari</strong>でこのページを開いてホーム画面に追加してください。Chrome等のブラウザではiOSのプッシュ通知は利用できません。
            </div>
          )}

          {installState === 'android-chrome' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">ホーム画面に追加すると、アプリとして快適に使えます。</p>
              {deferredPrompt ? (
                <button onClick={triggerAndroidInstall} className="btn btn-primary btn-sm">
                  ホーム画面に追加
                </button>
              ) : (
                <ol className="space-y-2 text-sm text-gray-700">
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">1</span>
                    <span>Chromeの右上メニュー（⋮）をタップ</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">2</span>
                    <span>「ホーム画面に追加」または「アプリをインストール」をタップ</span>
                  </li>
                </ol>
              )}
            </div>
          )}

          {installState === 'desktop' && (
            <p className="text-sm text-gray-500">Chromeのアドレスバー右端のインストールアイコンからインストールできます。</p>
          )}
        </div>
      )}

      {installState === 'already-installed' && (
        <div className="card p-4 flex items-center gap-3">
          <span className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <p className="text-sm text-gray-700 font-medium">ホーム画面にインストール済みです</p>
        </div>
      )}

      {/* Push notification settings */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">プッシュ通知</h2>

        {notifSupported === null ? (
          <div className="text-sm text-gray-400 py-2">読み込み中…</div>
        ) : !notifSupported ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            このブラウザはプッシュ通知に対応していません。
            {installState?.startsWith('ios') ? ' ホーム画面に追加してからSafariで開いてください（iOS 16.4以降）。' : ' Chrome・Edge・Firefox・Safari 16.4以降をお使いください。'}
          </div>
        ) : !vapidConfigured ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            サーバーのVAPID設定が未完了です。管理者設定でVAPIDキーを生成してください。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 mb-1">このブラウザの通知</p>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                  {permission === 'denied' && (
                    <p className="text-xs text-gray-500 mt-2">ブラウザの設定から通知を許可してください。</p>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {permission === 'granted' ? (
                    <button className="btn-danger btn-sm btn" onClick={unsubscribe} disabled={loading}>
                      無効にする
                    </button>
                  ) : permission !== 'denied' ? (
                    <button className="btn-primary btn-sm btn" onClick={requestPermissionAndSubscribe} disabled={loading}>
                      {loading ? '処理中…' : '有効にする'}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {permission === 'granted' && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">担当メールへの新着・返信で通知が届きます。</p>
                <button
                  className="btn btn-secondary btn-sm flex-shrink-0"
                  onClick={sendTestPush}
                  disabled={loading}
                >
                  テスト送信
                </button>
              </div>
            )}

            {permission !== 'granted' && (
              <p className="text-xs text-gray-500">担当メールへの新着・返信で通知が届きます。</p>
            )}
          </div>
        )}
      </div>

      {/* Registered devices */}
      {devices.length > 0 && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">登録済みデバイス</h2>
          <div className="space-y-2">
            {devices.map(dev => (
              <div key={dev.id} className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                <div className="flex-shrink-0 w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center">
                  {platformIcon(dev.platform)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{platformLabel(dev.platform)}</span>
                    {!dev.is_active && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">無効</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    最終確認: {new Date(dev.last_seen_at).toLocaleDateString('ja-JP')}
                  </p>
                </div>
                <button
                  onClick={() => removeDevice(dev.id)}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="削除"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
