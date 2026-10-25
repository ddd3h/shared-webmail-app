// Security policy that admins can change at runtime (stored in app_settings). Read often, so cached for a short while.
import { getSetting, setSetting, type AppSettingKey } from '@/lib/settings';
import { isValidRule, parseRules } from '@/lib/cidr';

export type SecurityPolicy = {
  allowedRules: string[];       // empty = anywhere
  allowedCountries: string[];   // empty = any country (only checked at login: the country comes from an IP lookup)
  sessionMaxDays: number;       // a session never lives longer than this, however active
  newDeviceAlert: boolean;      // tell people when their account is used from a browser it has not been used from before
  deviceBinding: boolean;       // a session cookie only works on the kind of device (browser + OS) it was issued to
};

export const DEFAULT_SESSION_MAX_DAYS = 14;
// How long the settings are remembered (the settings page clears it at once; this only matters for edits made elsewhere).
const ttlMs = () => Number(process.env.SECURITY_CACHE_TTL_MS ?? 15_000);
const KEYS = { cidrs: 'SECURITY_ALLOWED_CIDRS', countries: 'SECURITY_ALLOWED_COUNTRIES', days: 'SECURITY_SESSION_MAX_DAYS', alert: 'SECURITY_NEW_DEVICE_ALERT', binding: 'SECURITY_DEVICE_BINDING' } as const satisfies Record<string, AppSettingKey>;

const g = globalThis as unknown as { __secPolicy?: { at: number; value: SecurityPolicy } };

export function parsePolicy(raw: { cidrs: string | null; countries: string | null; days: string | null; alert: string | null; binding?: string | null }): SecurityPolicy {
  const days = Number(raw.days);
  return {
    allowedRules: parseRules(raw.cidrs ?? '').filter(isValidRule),
    allowedCountries: (raw.countries ?? '').split(/[\n,]/).map(s => s.trim()).filter(Boolean),
    sessionMaxDays: Number.isInteger(days) && days >= 1 && days <= 90 ? days : DEFAULT_SESSION_MAX_DAYS,
    newDeviceAlert: raw.alert !== 'off',
    deviceBinding: raw.binding !== 'off',
  };
}

export async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  if (g.__secPolicy && Date.now() - g.__secPolicy.at < ttlMs()) return g.__secPolicy.value;
  const [cidrs, countries, days, alert, binding] = await Promise.all(Object.values(KEYS).map(k => getSetting(k).catch(() => null)));
  const value = parsePolicy({ cidrs, countries, days, alert, binding });
  g.__secPolicy = { at: Date.now(), value };
  return value;
}

export async function saveSecurityPolicy(p: { allowed_cidrs: string; allowed_countries: string; session_max_days: number; new_device_alert: boolean; device_binding: boolean }, userId: string) {
  await setSetting(KEYS.cidrs, p.allowed_cidrs, false, userId);
  await setSetting(KEYS.countries, p.allowed_countries, false, userId);
  await setSetting(KEYS.days, String(p.session_max_days), false, userId);
  await setSetting(KEYS.alert, p.new_device_alert ? 'on' : 'off', false, userId);
  await setSetting(KEYS.binding, p.device_binding ? 'on' : 'off', false, userId);
  g.__secPolicy = undefined;
}
