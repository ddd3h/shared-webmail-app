// What happens when somebody has proved who they are (password or passkey): policy check, device memory,
// the session, the records, and a note to the person if it is a browser they haven't used before.
import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { deviceLabel } from '@/lib/device';
import type { IpInfo } from '@/lib/ip-lookup';
import { DEVICE_COOKIE, rememberDevice } from '@/lib/known-device';
import { logLoginAttempt } from '@/lib/login-log';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';
import { notifyNewDeviceLogin } from '@/lib/work-notify';

export type Who = { id: string; email: string; role: string };
export type Method = 'password' | 'passkey';
const METHOD_LABEL: Record<Method, string> = { password: 'パスワード', passkey: 'パスキー' };

export const placeOf = (info: IpInfo | null) => [info?.country, info?.city].filter(Boolean).join(' ') || info?.org || '場所不明';

/** Is the country of this address allowed? Unknown (private address, failed lookup) counts as allowed. */
export async function countryAllowed(info: IpInfo | null): Promise<boolean> {
  const { allowedCountries } = await loadSecurityPolicy();
  if (allowedCountries.length === 0 || !info?.country) return true;
  return allowedCountries.some(c => c.toLowerCase() === info.country!.toLowerCase());
}

export async function finishLogin(req: NextRequest, user: Who, o: { method: Method; ip: string; ipInfo: IpInfo | null; trustMfaDays?: number; extra?: Record<string, unknown> }): Promise<NextResponse> {
  const userAgent = req.headers.get('user-agent') || '';
  const { ip, ipInfo, method } = o;
  const networkType = ipInfo?.networkType ?? 'residential';
  const res = NextResponse.json({ ok: true, ...o.extra });

  const device = await rememberDevice(res, user.id, req.cookies.get(DEVICE_COOKIE)?.value, { ip, userAgent, country: ipInfo?.country, city: ipInfo?.city }, o.trustMfaDays ? new Date(Date.now() + o.trustMfaDays * 86400_000) : undefined);
  await setSessionCookie(res, { userId: user.id, email: user.email, role: user.role }, { ip, userAgent, networkType, country: ipInfo?.country, city: ipInfo?.city, deviceId: device.deviceId });
  prisma.users.update({ where: { id: user.id }, data: { last_login_at: new Date() } }).catch(() => {});

  await logAudit({ actorUserId: user.id, actionType: method === 'passkey' ? 'passkey_auth_success' : 'login_success', targetType: 'users', targetId: user.id, metadata: { ip, networkType } });
  logLoginAttempt({ userId: user.id, email: user.email, ipAddress: ip, userAgent, success: true, networkType, orgName: ipInfo?.org, country: ipInfo?.country, city: ipInfo?.city });

  // The very first login only sets the baseline; after that, an unfamiliar browser is worth telling the person about.
  if (device.isNew && device.hadAny) {
    await recordSecurityEvent({ type: 'new_device_login', severity: 'info', ip, userId: user.id, email: user.email, detail: { device: deviceLabel(userAgent), place: placeOf(ipInfo), method } });
    if ((await loadSecurityPolicy()).newDeviceAlert) void notifyNewDeviceLogin(user.id, { place: placeOf(ipInfo), device: deviceLabel(userAgent), ip, method: METHOD_LABEL[method], at: new Date() });
  }
  return res;
}
