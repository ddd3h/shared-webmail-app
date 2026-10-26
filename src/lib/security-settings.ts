// Security policy that admins can change at runtime (stored in app_settings). Read often, so cached for a short while.
import { getSetting, setSetting, type AppSettingKey } from '@/lib/settings';
import { isValidRule, parseRules } from '@/lib/cidr';

export type SecurityPolicy = {
  allowedRules: string[];       // empty = anywhere
  allowedCountries: string[];   // empty = any country (only checked at login: the country comes from an IP lookup)
  sessionMaxDays: number;       // a session never lives longer than this, however active
  newDeviceAlert: boolean;      // tell people when their account is used from a browser it has not been used from before
  deviceBinding: boolean;       // a session cookie only works on the kind of device (browser + OS) it was issued to
  require2fa: boolean;          // logging in with a password needs a second step (a passkey is two factors by itself)
  rememberDays: number;         // the installed app (PWA) stays logged in this many days after its last use, proved by the device's own key (0 = never)
  blockBots: boolean;           // refuse AI crawlers, scripts and headless browsers (by what they say they are; see src/lib/bot-guard.ts)
  mfaTrustDays: number;         // days a browser may skip the second step after the person ticked "trust this browser" (0 = never)
};

export const DEFAULT_SESSION_MAX_DAYS = 14;
export const DEFAULT_MFA_TRUST_DAYS = 30;
export const DEFAULT_REMEMBER_DAYS = 30;
// How long the settings are remembered (the settings page clears it at once; this only matters for edits made elsewhere).
const ttlMs = () => Number(process.env.SECURITY_CACHE_TTL_MS ?? 15_000);
const KEYS = { cidrs: 'SECURITY_ALLOWED_CIDRS', countries: 'SECURITY_ALLOWED_COUNTRIES', days: 'SECURITY_SESSION_MAX_DAYS', alert: 'SECURITY_NEW_DEVICE_ALERT', binding: 'SECURITY_DEVICE_BINDING', twofa: 'SECURITY_REQUIRE_2FA', trust: 'SECURITY_MFA_TRUST_DAYS', bots: 'SECURITY_BLOCK_BOTS', remember: 'SECURITY_REMEMBER_DAYS' } as const satisfies Record<string, AppSettingKey>;

const g = globalThis as unknown as { __secPolicy?: { at: number; value: SecurityPolicy } };

export function parsePolicy(raw: { cidrs: string | null; countries: string | null; days: string | null; alert: string | null; binding?: string | null; twofa?: string | null; trust?: string | null; bots?: string | null; remember?: string | null }): SecurityPolicy {
  const trust = Number(raw.trust);
  const remember = Number(raw.remember);
  const days = Number(raw.days);
  return {
    allowedRules: parseRules(raw.cidrs ?? '').filter(isValidRule),
    allowedCountries: (raw.countries ?? '').split(/[\n,]/).map(s => s.trim()).filter(Boolean),
    sessionMaxDays: Number.isInteger(days) && days >= 1 && days <= 90 ? days : DEFAULT_SESSION_MAX_DAYS,
    newDeviceAlert: raw.alert !== 'off',
    deviceBinding: raw.binding !== 'off',
    rememberDays: raw.remember != null && raw.remember !== '' && Number.isInteger(remember) && remember >= 0 && remember <= 90 ? remember : DEFAULT_REMEMBER_DAYS,
    blockBots: raw.bots !== 'off', // on unless somebody explicitly turned it off
    require2fa: raw.twofa !== 'off', // on unless somebody explicitly turned it off
    mfaTrustDays: raw.trust != null && raw.trust !== '' && Number.isInteger(trust) && trust >= 0 && trust <= 90 ? trust : DEFAULT_MFA_TRUST_DAYS,
  };
}

export async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  if (g.__secPolicy && Date.now() - g.__secPolicy.at < ttlMs()) return g.__secPolicy.value;
  const [cidrs, countries, days, alert, binding, twofa, trust, bots, remember] = await Promise.all(Object.values(KEYS).map(k => getSetting(k).catch(() => null)));
  const value = parsePolicy({ cidrs, countries, days, alert, binding, twofa, trust, bots, remember });
  g.__secPolicy = { at: Date.now(), value };
  return value;
}

export async function saveSecurityPolicy(p: { allowed_cidrs: string; allowed_countries: string; session_max_days: number; new_device_alert: boolean; device_binding: boolean; require_2fa: boolean; mfa_trust_days: number; block_bots: boolean; remember_days: number }, userId: string) {
  await setSetting(KEYS.cidrs, p.allowed_cidrs, false, userId);
  await setSetting(KEYS.countries, p.allowed_countries, false, userId);
  await setSetting(KEYS.days, String(p.session_max_days), false, userId);
  await setSetting(KEYS.alert, p.new_device_alert ? 'on' : 'off', false, userId);
  await setSetting(KEYS.binding, p.device_binding ? 'on' : 'off', false, userId);
  await setSetting(KEYS.twofa, p.require_2fa ? 'on' : 'off', false, userId);
  await setSetting(KEYS.trust, String(p.mfa_trust_days), false, userId);
  await setSetting(KEYS.bots, p.block_bots ? 'on' : 'off', false, userId);
  await setSetting(KEYS.remember, String(p.remember_days), false, userId);
  g.__secPolicy = undefined;
}
