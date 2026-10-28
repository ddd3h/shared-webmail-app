// Writes one line to the log for every request that took too long, so that "the app is slow" can be traced to the API behind it:
//
//   [slow] GET /api/threads 200 1235ms
//
// - The time is the whole request: proxy.ts (session / IP checks), the route handler and the database, until the answer is sent.
// - The query string is dropped (it can hold search words and addresses) and ids become :id, so the same API adds up in one line.
// - SLOW_REQUEST_MS sets the limit (default 500). 0 turns it off.
import http from 'node:http';

const DEFAULT_MS = 500;
const STATIC_PREFIXES = ['/_next/', '/sw.js', '/manifest', '/icon', '/favicon.ico'];
const ID_SEGMENT = /\/c[a-z0-9]{24}(?=\/|$)/g; // cuid, the id format of every table

export function slowThresholdMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MS;
}

export function slowRequestLine(r: { method: string; url: string; status: number; ms: number; thresholdMs: number }): string | null {
  if (r.thresholdMs <= 0 || r.ms < r.thresholdMs) return null;
  const path = r.url.split('?')[0];
  if (STATIC_PREFIXES.some(p => path.startsWith(p))) return null;
  return `[slow] ${r.method} ${path.replace(ID_SEGMENT, '/:id')} ${r.status} ${Math.round(r.ms)}ms`;
}

/**
 * Times every request of every http server in this process. Next.js has no hook for the end of a request (proxy.ts returns
 * before the route handler runs), so the 'request' event of the server itself is watched. Safe to call twice.
 */
export function installSlowRequestLog(): void {
  const g = globalThis as { __slowRequestLog?: boolean };
  const thresholdMs = slowThresholdMs(process.env.SLOW_REQUEST_MS);
  if (g.__slowRequestLog || thresholdMs <= 0) return;
  g.__slowRequestLog = true;

  const proto = http.Server.prototype;
  const emit = proto.emit;
  proto.emit = function (this: http.Server, event: string | symbol, ...args: any[]) {
    if (event === 'request') {
      const req = args[0] as http.IncomingMessage;
      const res = args[1] as http.ServerResponse;
      const start = performance.now();
      res.once('finish', () => {
        const line = slowRequestLine({ method: req.method ?? '?', url: req.url ?? '', status: res.statusCode, ms: performance.now() - start, thresholdMs });
        if (line) console.log(line);
      });
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>);
  } as typeof proto.emit;

  console.log(`[slow] requests over ${thresholdMs}ms are logged (SLOW_REQUEST_MS)`);
}
