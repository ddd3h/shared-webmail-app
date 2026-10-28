// Writes lines to the log that show which requests make the server slow or heavy:
//
//   [slow] GET /api/threads 200 1235ms                      a request that took too long
//   [big]  GET /api/threads/:id 200 34.7MB                  an answer of several MB (it is built in memory, then sent)
//   [mem]  rss=255MB heap=120/150MB external=20MB buffers=10MB | GET /api/threads x12 · ...
//                                                            the memory of the server, when it moved by 50MB or more (or every 10 minutes),
//                                                            with the requests that came in since the last line
//
// - The time is the whole request: proxy.ts (session / IP checks), the route handler and the database, until the answer is sent.
// - The query string is dropped (it can hold search words and addresses) and ids become :id, so the same API adds up in one line.
// - SLOW_REQUEST_MS sets the limit (default 500; 0 turns all of this off). BIG_RESPONSE_MB sets the size for [big] (default 3; 0 = off).
import http from 'node:http';

const DEFAULT_MS = 500;
const DEFAULT_BIG_MB = 3;
const MB = 1024 * 1024;
const MEM_SAMPLE_MS = 20_000;
const MEM_STEP_MB = 50;
const MEM_HEARTBEAT_MS = 10 * 60_000;
const MEM_TOP_REQUESTS = 5;
const STATIC_PREFIXES = ['/_next/', '/sw.js', '/manifest', '/icon', '/favicon.ico'];
const ID_SEGMENT = /\/c[a-z0-9]{24}(?=\/|$)/g; // cuid, the id format of every table

export type RequestWindow = Map<string, { n: number; maxMs: number; maxBytes: number }>;
export type MemSample = { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };

function nonNegative(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
export const slowThresholdMs = (raw: string | undefined): number => nonNegative(raw, DEFAULT_MS);
export const bigThresholdBytes = (raw: string | undefined): number => Math.round(nonNegative(raw, DEFAULT_BIG_MB) * MB);

/** "GET /api/threads/:id": what kind of request this is. Static files have none. */
export function requestKey(method: string, url: string): string | null {
  const path = url.split('?')[0];
  if (STATIC_PREFIXES.some(p => path.startsWith(p))) return null;
  return `${method} ${path.replace(ID_SEGMENT, '/:id')}`;
}

export function slowRequestLine(r: { method: string; url: string; status: number; ms: number; thresholdMs: number }): string | null {
  if (r.thresholdMs <= 0 || r.ms < r.thresholdMs) return null;
  const key = requestKey(r.method, r.url);
  return key ? `[slow] ${key} ${r.status} ${Math.round(r.ms)}ms` : null;
}

export function bigResponseLine(r: { method: string; url: string; status: number; bytes: number; thresholdBytes: number }): string | null {
  if (r.thresholdBytes <= 0 || r.bytes < r.thresholdBytes) return null;
  const key = requestKey(r.method, r.url);
  return key ? `[big] ${key} ${r.status} ${(r.bytes / MB).toFixed(1)}MB` : null;
}

export function memLine(m: MemSample, recent: RequestWindow): string {
  const mb = (n: number) => Math.round(n / MB);
  const head = `[mem] rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB external=${mb(m.external)}MB buffers=${mb(m.arrayBuffers)}MB`;
  const top = [...recent].sort((a, b) => b[1].n - a[1].n).slice(0, MEM_TOP_REQUESTS)
    .map(([key, v]) => `${key} x${v.n}${v.maxBytes >= MB ? ` (最大${(v.maxBytes / MB).toFixed(1)}MB)` : ''}`);
  return top.length > 0 ? `${head} | ${top.join(' · ')}` : head;
}

export function memShouldLog(lastLoggedMb: number | null, rssMb: number, sinceLastMs: number): boolean {
  return lastLoggedMb === null || Math.abs(rssMb - lastLoggedMb) >= MEM_STEP_MB || sinceLastMs >= MEM_HEARTBEAT_MS;
}

/**
 * Times every request of every http server in this process. Next.js has no hook for the end of a request (proxy.ts returns
 * before the route handler runs), so the 'request' event of the server itself is watched. Safe to call twice.
 */
export function installSlowRequestLog(): void {
  const g = globalThis as { __slowRequestLog?: boolean };
  const thresholdMs = slowThresholdMs(process.env.SLOW_REQUEST_MS);
  const bigBytes = bigThresholdBytes(process.env.BIG_RESPONSE_MB);
  if (g.__slowRequestLog || thresholdMs <= 0) return;
  g.__slowRequestLog = true;

  let window: RequestWindow = new Map();
  const note = (key: string, ms: number, bytes: number) => {
    const w = window.get(key) ?? { n: 0, maxMs: 0, maxBytes: 0 };
    w.n++; w.maxMs = Math.max(w.maxMs, ms); w.maxBytes = Math.max(w.maxBytes, bytes);
    window.set(key, w);
  };

  const proto = http.Server.prototype;
  const emit = proto.emit;
  proto.emit = function (this: http.Server, event: string | symbol, ...args: any[]) {
    if (event === 'request') {
      const req = args[0] as http.IncomingMessage;
      const res = args[1] as http.ServerResponse;
      const start = performance.now();
      res.once('finish', () => {
        const method = req.method ?? '?', url = req.url ?? '';
        const ms = performance.now() - start;
        const bytes = Number(res.getHeader('content-length')) || 0; // unknown (0) for streamed answers
        const key = requestKey(method, url);
        if (key) note(key, ms, bytes);
        const slow = slowRequestLine({ method, url, status: res.statusCode, ms, thresholdMs });
        if (slow) console.log(slow);
        const big = bigResponseLine({ method, url, status: res.statusCode, bytes, thresholdBytes: bigBytes });
        if (big) console.log(big);
      });
    }
    return emit.apply(this, [event, ...args] as Parameters<typeof emit>);
  } as typeof proto.emit;

  let lastMb: number | null = null;
  let lastAt = Date.now();
  setInterval(() => {
    const m = process.memoryUsage();
    const rssMb = Math.round(m.rss / MB);
    if (memShouldLog(lastMb, rssMb, Date.now() - lastAt)) {
      console.log(memLine(m, window));
      lastMb = rssMb; lastAt = Date.now(); window = new Map();
    }
  }, MEM_SAMPLE_MS).unref();

  console.log(`[slow] requests over ${thresholdMs}ms are logged (SLOW_REQUEST_MS); [big] answers over ${bigBytes / MB}MB (BIG_RESPONSE_MB); [mem] server memory`);
}
