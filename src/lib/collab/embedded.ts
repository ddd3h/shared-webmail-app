// Authenticated y-websocket collaboration server, runnable IN-PROCESS inside the
// Next.js app (via src/instrumentation.ts) so a single pm2 process serves both
// the app (3000) and realtime collaboration (COLLAB_PORT, default 1234).
//
// Verifies the iron-webcrypto `sid` session cookie before upgrading the socket,
// so only logged-in users can join a collaboration room.

import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import * as Iron from 'iron-webcrypto';

let started = false;

export function startEmbeddedCollab(projectRoot: string) {
  if (started) return;
  started = true;

  // y-websocket@1.5.4 doesn't expose ./bin/utils.js via package "exports", and a
  // standalone build's minimal node_modules lacks it — resolve from the project
  // root's full node_modules at runtime.
  const require = createRequire(path.join(projectRoot, 'package.json'));
  const utilsPath = path.join(projectRoot, 'node_modules', 'y-websocket', 'bin', 'utils.js');
  const { setupWSConnection } = require(utilsPath);

  const HOST = process.env.HOST || '0.0.0.0';
  const PORT = parseInt(process.env.COLLAB_PORT || '1234', 10);

  const SESSION_COOKIE = 'sid';
  const secret = process.env.SESSION_SECRET || 'dev-secret-at-least-32-chars-long!!';
  const password = { 1: { id: '1', secret } }; // mirror src/lib/auth.ts (keyed by '1')
  const INACTIVITY_MS = 12 * 60 * 60 * 1000;   // keep in sync with src/lib/auth.ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cryptoImpl: any = globalThis.crypto;
  const verbose = process.env.NODE_ENV !== 'production';

  function parseCookies(header?: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
    return out;
  }

  async function verifySession(req: http.IncomingMessage) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    try {
      const session = await Iron.unseal(cryptoImpl, token, password, { ...Iron.defaults, ttl: 0 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = session as any;
      if (!s) return null;
      if (Date.now() - (s.lastActivity || 0) > INACTIVITY_MS) return null;
      return s;
    } catch {
      return null;
    }
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => setupWSConnection(ws, req, { gc: true }));

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('collab server ok');
  });

  server.on('upgrade', (req, socket, head) => {
    verifySession(req).then((session) => {
      if (!session) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e?.code === 'EADDRINUSE') {
      console.warn(`[collab] port ${PORT} already in use — assuming collab already running`);
    } else {
      console.error('[collab] server error:', e);
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[collab] embedded y-websocket listening on ${HOST}:${PORT} (verbose=${verbose})`);
  });
}
