// Lockdown: when an attack is too big for the per-address defences (blocks, limits), the app shuts out EVERY connection and mails the admin.
// The state lives in app_settings (key LOCKDOWN) so it survives a restart. It is lifted on the server: `node --env-file=.env scripts/lockdown.mjs release`.
import { prisma } from '@/lib/db';
import { recordSecurityEvent } from '@/lib/security-events';
import { sendNotificationEmail } from '@/lib/notify-mail';

export const LOCKDOWN_KEY = 'LOCKDOWN';

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const lockdownLimits = () => ({
  windowMs: num(process.env.LOCKDOWN_WINDOW_SEC, 300) * 1000, // the last 5 minutes
  fails: num(process.env.LOCKDOWN_FAILS, 300),               // this many failed password checks ...
  ips: num(process.env.LOCKDOWN_IPS, 100),                   // ... AND failures from this many different addresses (both, so 100 cheap addresses trying once cannot shut the app)
});
/** The lockdown lifts itself after this long, so a missed mail cannot keep the app shut for ever. */
export const lockdownMaxMs = () => num(process.env.LOCKDOWN_MAX_MINUTES, 120) * 60_000;
/** Only a failure that got as far as the password check counts. Refused requests (blocked address, rate limit, sweep, bot) never reach it, so
 *  they are not counted: the lockdown answers an attack that got PAST the other defences, and cheap refused traffic cannot trigger it. */
export const COUNTED_FAILURES = new Set(['wrong_password', 'user_not_found']);
export const lockdownEnabled = () => process.env.LOCKDOWN !== 'off';

/** Failed logins of the last window. Pure and in memory (one process), so it is cheap to call on every failure. */
export class FailureMeter {
  private hits: { at: number; ip: string }[] = [];
  constructor(private limits = lockdownLimits) {}
  /** Notes one failure; returns the numbers when the window is over a limit, else null. */
  note(ip: string, now = Date.now()): { fails: number; ips: number; windowSec: number } | null {
    const { windowMs, fails, ips } = this.limits();
    const from = now - windowMs;
    let i = 0;
    while (i < this.hits.length && this.hits[i].at < from) i++;
    if (i > 0) this.hits = this.hits.slice(i);
    this.hits.push({ at: now, ip });
    const distinct = new Set(this.hits.map(h => h.ip)).size;
    if (this.hits.length >= fails && distinct >= ips) return { fails: this.hits.length, ips: distinct, windowSec: windowMs / 1000 };
    return null;
  }
  reset() { this.hits = []; }
}

const g = globalThis as unknown as { __lockdown?: { on: boolean; at: number }; __failMeter?: FailureMeter; __shutOut?: { n: number; ips: Set<string>; noted: number } };
const meter = () => (g.__failMeter ??= new FailureMeter());
const cacheMs = () => num(process.env.LOCKDOWN_CACHE_MS, 5000);

/** True while the lockdown is on. Fails open if the DB cannot be read (a DB outage must not look like an attack). */
export async function isLockedDown(): Promise<boolean> {
  const c = g.__lockdown;
  if (c && Date.now() - c.at < cacheMs()) return c.on;
  try {
    const row = await prisma.app_settings.findUnique({ where: { key: LOCKDOWN_KEY }, select: { value: true } });
    let on = !!row;
    if (row && expired(row.value)) { // the time is up: lift it
      await prisma.app_settings.deleteMany({ where: { key: LOCKDOWN_KEY } });
      g.__failMeter?.reset();
      await recordSecurityEvent({ type: 'lockdown_expired', severity: 'warn', detail: { maxMinutes: lockdownMaxMs() / 60_000 } });
      on = false;
    }
    g.__lockdown = { on, at: Date.now() };
  } catch {
    return c?.on ?? false;
  }
  return g.__lockdown.on;
}

export function expired(value: string, now = Date.now(), maxMs = lockdownMaxMs()): boolean {
  try { const at = Date.parse(JSON.parse(value).at); return Number.isFinite(at) && now - at > maxMs; } catch { return false; }
}

/** While shut, the refused requests are counted and summed up in one security event a minute, so the admin can see whether the attack goes on. */
export async function noteShutOut(ip: string, now = Date.now()): Promise<void> {
  const t = (g.__shutOut ??= { n: 0, ips: new Set(), noted: now });
  t.n++; if (t.ips.size < 10_000) t.ips.add(ip);
  if (now - t.noted < 60_000) return;
  const detail = { requests: t.n, addresses: t.ips.size, sinceSec: Math.round((now - t.noted) / 1000) };
  g.__shutOut = { n: 0, ips: new Set(), noted: now };
  await recordSecurityEvent({ type: 'lockdown_active', severity: 'warn', detail });
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export async function engageLockdown(why: { fails: number; ips: number; windowSec: number }, lastIp: string): Promise<void> {
  if (g.__lockdown?.on) return;
  g.__lockdown = { on: true, at: Date.now() }; // shut at once; the DB write follows
  const at = new Date();
  const value = JSON.stringify({ at: at.toISOString(), ...why });
  try {
    await prisma.app_settings.upsert({ where: { key: LOCKDOWN_KEY }, create: { key: LOCKDOWN_KEY, value }, update: { value } });
  } catch (e) { console.error('[lockdown] could not save the state', e); }
  await recordSecurityEvent({ type: 'lockdown_engaged', severity: 'alert', ip: lastIp, detail: why });
  if (!process.env.NOTIFY_ADMIN_EMAIL || !process.env.NOTIFY_SMTP_HOST) console.error('[lockdown] NOTIFY_* is not set: no mail can be sent about this lockdown');
  const when = at.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const html = `<div style="font-family:sans-serif;max-width:560px">
<h2 style="color:#b91c1c">🚨 シャットアウトしました（すべての接続を遮断中）</h2>
<p>大量のログイン失敗を検知し、自動ブロックでは防ぎきれないと判断したため、安全のためにすべての接続を遮断しました。</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 12px;color:#6b7280">日時</td><td><strong>${esc(when)}</strong></td></tr>
<tr><td style="padding:6px 12px;color:#6b7280">直近${Math.round(why.windowSec / 60)}分のログイン失敗</td><td><strong>${why.fails}回</strong></td></tr>
<tr><td style="padding:6px 12px;color:#6b7280">失敗した接続元の数</td><td><strong>${why.ips}件</strong></td></tr>
<tr><td style="padding:6px 12px;color:#6b7280">最後の接続元</td><td style="font-family:monospace">${esc(lastIp)}</td></tr></table>
<p style="margin-top:16px;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px"><strong>解除の方法</strong>（サーバーで）:<br>
<code>cd ~/shared-webmail-app &amp;&amp; node --env-file=.env scripts/lockdown.mjs release</code><br>
解除しなくても、${lockdownMaxMs() / 60_000}分たつと自動で解除されます。攻撃が続いているうちに解除すると、すぐに再びシャットアウトします。ログ（セキュリティ画面の「lockdown_engaged」）を確認してから解除してください。</p></div>`;
  await sendNotificationEmail('[緊急] シャットアウトしました — すべての接続を遮断中', html).catch(e => console.error('[lockdown] mail failed:', e?.message));
}

/** Called for every failed or refused login. Shuts the app when the window of failures is over a limit. */
export async function noteLoginFailureForLockdown(ip: string, reason?: string | null): Promise<void> {
  if (!lockdownEnabled() || g.__lockdown?.on || !reason || !COUNTED_FAILURES.has(reason)) return;
  const over = meter().note(ip);
  if (over) await engageLockdown(over, ip);
}
