import { NextRequest, NextResponse } from 'next/server';
import { lookupIp } from '@/lib/ip-lookup';
import { countryAllowed, finishResume, placeOf } from '@/lib/login-flow';
import { addStrike, gateAddress } from '@/lib/login-guard';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { checkResume } from '@/lib/remember-login';
import { recordSecurityEvent } from '@/lib/security-events';

const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

// POST /api/auth/resume { challenge, signature } - step 2: the installed app proves it holds its device key.
// Every refusal looks the same from outside (401); the reason is kept for the administrator.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const address = await gateAddress(ip);
  if (!address.ok) return NextResponse.json({ error: address.error }, { status: address.status });

  const body = await req.json().catch(() => ({}));
  const result = await checkResume(req, ip, body);
  const ipInfo = await lookupIp(ip).catch(() => null);

  if (result.ok && !(await countryAllowed(ipInfo))) {
    await recordSecurityEvent({ type: 'device_login_refused', severity: 'warn', ip, userId: result.user.id, email: result.user.email, detail: { reason: 'country', country: ipInfo?.country, key_id: result.device.key_id?.slice(0, 12) } });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!result.ok) {
    // somebody holding a device cookie but not its key, or a key from another kind of browser, is worth a note; "nothing to resume" is routine
    if ('device' in result && result.device) {
      await recordSecurityEvent({ type: 'device_login_refused', severity: 'warn', ip, userId: result.device.user_id, email: result.device.user.email, detail: { reason: result.reason, key_id: result.device.key_id?.slice(0, 12), place: placeOf(ipInfo) } });
    }
    const f = checkRateLimit(`resume:fail:${ip}`, FAIL_LIMIT, FAIL_WINDOW_MS);
    if (!f.allowed) {
      if (f.isFirstBlock) void addStrike(ip, 'アプリの自動ログインの失敗が続きました');
      return NextResponse.json({ error: 'too_many_requests' }, { status: 429, headers: { 'Retry-After': String(Math.max(1, f.retryAfterSec)) } });
    }
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return finishResume(req, { id: result.device.id, user: { id: result.user.id, email: result.user.email, role: result.user.role } }, { ip, ipInfo });
}
