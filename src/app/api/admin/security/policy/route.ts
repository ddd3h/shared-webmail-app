import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { matchesAny, parseRules, isValidRule } from '@/lib/cidr';
import { getClientIp } from '@/lib/rate-limit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { getSetting } from '@/lib/settings';
import { loadSecurityPolicy, saveSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';

const schema = z.object({
  allowed_cidrs: z.string().max(5000),
  allowed_countries: z.string().max(500),
  session_max_days: z.number().int().min(1).max(90),
  new_device_alert: z.boolean(),
  device_binding: z.boolean(),
  // omitted = keep what is set now
  require_2fa: z.boolean().optional(),
  mfa_trust_days: z.number().int().min(0).max(90).optional(),
});

// GET /api/admin/security/policy - the current rules, and which address the admin is calling from
export async function GET(req: NextRequest) {
  if (!(await adminActor())) return forbidden();
  const p = await loadSecurityPolicy();
  const [cidrs, countries] = await Promise.all([getSetting('SECURITY_ALLOWED_CIDRS'), getSetting('SECURITY_ALLOWED_COUNTRIES')]);
  return NextResponse.json({ allowed_cidrs: cidrs ?? '', allowed_countries: countries ?? '', session_max_days: p.sessionMaxDays, new_device_alert: p.newDeviceAlert, device_binding: p.deviceBinding, require_2fa: p.require2fa, mfa_trust_days: p.mfaTrustDays, your_ip: getClientIp(req) });
}

// PUT /api/admin/security/policy
// An allowed-networks list that doesn't include the admin's own address would lock them out the moment it is saved, so it is refused.
export async function PUT(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const lines = parseRules(d.allowed_cidrs);
  const bad = lines.filter(l => !isValidRule(l));
  if (bad.length > 0) return NextResponse.json({ error: 'invalid_rule', message: `書式が正しくない行があります: ${bad.slice(0, 3).join(', ')}` }, { status: 400 });
  const ip = getClientIp(req);
  if (lines.length > 0 && ip !== 'unknown' && !matchesAny(ip, lines)) {
    return NextResponse.json({ error: 'locks_yourself_out', message: `許可リストにあなたの現在のアドレス（${ip}）が含まれていません。保存するとあなた自身がログインできなくなります` }, { status: 409 });
  }
  const current = await loadSecurityPolicy();
  const require_2fa = d.require_2fa ?? current.require2fa;
  await saveSecurityPolicy({ ...d, require_2fa, mfa_trust_days: d.mfa_trust_days ?? current.mfaTrustDays }, actor.id);
  if (require_2fa !== current.require2fa) {
    // turning the second step off is the one change that weakens every account at once: leave a loud record
    await recordSecurityEvent({ type: require_2fa ? 'policy_2fa_on' : 'policy_2fa_off', severity: require_2fa ? 'info' : 'alert', userId: actor.id });
  }
  await logAudit({ actorUserId: actor.id, actionType: 'security_policy_update', targetType: 'app_settings', metadata: { rules: lines.length, countries: d.allowed_countries, session_max_days: d.session_max_days, new_device_alert: d.new_device_alert, device_binding: d.device_binding, require_2fa, mfa_trust_days: d.mfa_trust_days ?? current.mfaTrustDays } });
  return NextResponse.json({ ok: true });
}
