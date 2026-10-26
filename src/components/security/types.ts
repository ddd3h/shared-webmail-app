export type Overview = {
  summary: { failed_24h: number; succeeded_24h: number; active_sessions: number; blocked: number; locked: number };
  top_ips: { key: string; count: number }[];
  top_accounts: { key: string; count: number }[];
  events: { id: string; type: string; severity: 'info' | 'warn' | 'alert'; ip: string | null; email: string | null; detail: Record<string, unknown> | null; at: string }[];
  blocks: { id: string; ip: string; reason: string; source: 'manual' | 'auto'; expires_at: string | null; created_at: string }[];
  locked: { id: string; name: string; email: string }[];
  people: { id: string; name: string; email: string; mfa: boolean; passkeys: number }[];
  recent_logins: { id: string; success: boolean; reason: string | null; ip: string; device: string; place: string | null; at: string; email: string; name: string | null }[];
};
export type Policy = { allowed_cidrs: string; allowed_countries: string; session_max_days: number; new_device_alert: boolean; device_binding: boolean; require_2fa: boolean; mfa_trust_days: number; block_bots: boolean; your_ip: string };

export const EVENT_LABEL: Record<string, string> = {
  login_sweep: '多数のアカウントを試行（スイーピング）', ip_blocked: 'アドレスを自動ブロック', sweep_detected: '大量アクセスを検知', bad_origin: '他サイトからの更新リクエストを拒否',
  new_device_login: '新しい端末からのログイン', login_country_blocked: '許可されていない国からのログイン', mfa_enabled: '2段階認証が有効になった', mfa_disabled: '2段階認証が解除された', mfa_reset: '管理者が2段階認証をリセット', mfa_recovery_used: '回復コードでログイン', mfa_locked: '認証コードの入力を何度も間違えた', policy_2fa_off: '「パスワード＋2段階認証」の必須設定がオフにされた', policy_2fa_on: '「パスワード＋2段階認証」が必須になった',
  bot_blocked: 'ロボット（AI・クローラ・スクリプト）の接続を拒否',
  ip_unknown: '接続元のIPアドレスが分からないアクセスを拒否',
  session_ip_mismatch: '別のIPアドレスからのセッション使用を検知し、セッションを終了',
  session_device_mismatch: 'Cookieの使い回しを疑い、セッションを終了',
  session_max_age: '期限切れのセッションを終了', session_locked_account: 'ロック中のアカウントのセッションを終了', user_locked: 'アカウントをロック', user_unlocked: 'アカウントのロックを解除',
};
export const SEVERITY_STYLE = { info: 'bg-gray-100 text-gray-600', warn: 'bg-amber-100 text-amber-700', alert: 'bg-red-100 text-red-700' } as const;
export const SEVERITY_LABEL = { info: '情報', warn: '注意', alert: '警告' } as const;

// What a stored failure reason means, in words (limits have several variants that read the same to a person)
const REASONS: Record<string, string> = {
  wrong_password: 'パスワード違い', user_not_found: 'パスワード違い', account_locked: 'アカウントがロック中', country_not_allowed: '許可されていない国',
  ip_blocked: 'ブロック中のアドレス', wrong_2fa: '認証コードが違う', network_not_allowed: '許可されていないネットワーク', sweep_blocked: 'スイーピング（多数のアカウントを試行）',
};
export const reasonLabel = (reason: string | null) => (!reason ? '' : reason.startsWith('rate_limited') ? '試行回数の制限' : REASONS[reason] ?? reason);
