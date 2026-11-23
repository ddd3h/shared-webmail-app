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
import { liveFromToken } from '@/lib/auth';
import { checkAccess } from '@/lib/draft-access';

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

  // loopback only: nginx is the sole entry (wss://<host>/collab). A socket that reached the port directly could name any address
  // in X-Forwarded-For and pass the session's address check.
  const HOST = process.env.COLLAB_HOST || '127.0.0.1';
  const PORT = parseInt(process.env.COLLAB_PORT || '1234', 10);

  const SESSION_COOKIE = 'sid';
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

  // The person behind the socket: the same cookie and the same rules as every request of the app (lib/auth.ts checkLive):
  // the session still exists, the account is not locked, it is not idle or too old, and the socket comes from an address the
  // session was proved from. A session held for a changed address may not join until the person confirms it in the app.
  async function verifySession(req: http.IncomingMessage): Promise<{ userId: string } | null> {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    // As Next.js does for the app's own requests (server/base-server.js): without an X-Forwarded-For, the address the request came
    // from stands in for it. Through nginx the header is there; a direct connection can only come from this machine (loopback).
    const header = (name: string) => {
      const v = req.headers[name];
      if (name === 'x-forwarded-for' && v === undefined) return req.socket.remoteAddress ?? null;
      return Array.isArray(v) ? v.join(', ') : v ?? null;
    };
    const live = await liveFromToken(token, header).catch(() => null);
    if (!live || !('session' in live) || live.moved) return null;
    return { userId: live.session.userId };
  }

  // A room is one draft (`webmail-draft-<id>`): only the people who may edit that draft may join it.
  // The room is the last part of the path: `/webmail-draft-<id>`, or `/collab/webmail-draft-<id>` when nginx passes the prefix on.
  async function mayJoin(userId: string, url: string | undefined): Promise<boolean> {
    const room = (url ?? '').split('?')[0].split('/').pop() ?? '';
    const m = /^webmail-draft-([A-Za-z0-9_-]+)$/.exec(room);
    if (!m) return false;
    const { accessible } = await checkAccess(m[1], userId, true).catch(() => ({ accessible: false }));
    return accessible;
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => setupWSConnection(ws, req, { gc: true }));

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('collab server ok');
  });

  server.on('upgrade', (req, socket, head) => {
    verifySession(req).then(async (session) => {
      if (!session || !(await mayJoin(session.userId, req.url))) {
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
