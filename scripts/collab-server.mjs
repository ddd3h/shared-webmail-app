#!/usr/bin/env node
// Authenticated y-websocket collaboration server for shared draft editing.
//
// Replaces the default `node_modules/y-websocket/bin/server.js`, which has NO
// authentication — anyone who knows a room name (webmail-draft-<id>) could read
// and modify a draft's body. This wrapper verifies the iron-webcrypto session
// cookie (same `sid` cookie the Next.js app uses) before upgrading the socket,
// so only logged-in users can join a collaboration room.
//
// Env:
//   HOST            bind address (default 0.0.0.0)
//   COLLAB_PORT     listen port (default 1234; falls back to PORT)
//   SESSION_SECRET  MUST match the Next.js app (used to unseal the session)
//   NODE_ENV        when not "production", auth failures are logged verbosely
//
// Run:  node scripts/collab-server.mjs
// (See ecosystem.config.cjs / deploy/collab.service for production process mgmt.)

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import * as Iron from 'iron-webcrypto';

const require = createRequire(import.meta.url);
// y-websocket@1.5.4 does not expose ./bin/utils.js via package "exports", so
// resolve it by absolute path to bypass the exports map.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const utilsPath = path.join(__dirname, '..', 'node_modules', 'y-websocket', 'bin', 'utils.js');
const { setupWSConnection } = require(utilsPath);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.COLLAB_PORT || process.env.PORT || '1234', 10);

const SESSION_COOKIE = 'sid';
const secret = process.env.SESSION_SECRET || 'dev-secret-at-least-32-chars-long!!';
// Mirror src/lib/auth.ts: password keyed by id '1'.
const password = { 1: { id: '1', secret } };
const INACTIVITY_MS = 12 * 60 * 60 * 1000; // keep in sync with src/lib/auth.ts
const cryptoImpl = globalThis.crypto;
const verbose = process.env.NODE_ENV !== 'production';

if (secret === 'dev-secret-at-least-32-chars-long!!' && !verbose) {
  console.error('[collab] FATAL: SESSION_SECRET not set in production. Refusing to start.');
  process.exit(1);
}

function parseCookies(header) {
  const out = {};
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

async function verifySession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const session = await Iron.unseal(cryptoImpl, token, password, { ...Iron.defaults, ttl: 0 });
    if (!session) return null;
    if (Date.now() - (session.lastActivity || 0) > INACTIVITY_MS) return null;
    return session;
  } catch (e) {
    if (verbose) console.warn('[collab] unseal failed:', e?.message ?? e);
    return null;
  }
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  // docName defaults to the URL path (room id), e.g. "webmail-draft-<id>"
  setupWSConnection(ws, req, { gc: true });
});

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('collab server ok');
});

server.on('upgrade', (req, socket, head) => {
  verifySession(req).then((session) => {
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      if (verbose) console.warn('[collab] rejected unauthenticated upgrade from', socket.remoteAddress);
      return;
    }
    // NOTE: per-draft authorization (is this user allowed on THIS draft?) is not
    // enforced here — only that the user is logged in. Team-draft rooms are only
    // opened by ComposeForm for team mailboxes the user can already access, and
    // the authoritative yjs_state persistence (PUT /api/drafts/[id]/yjs) re-checks
    // access server-side. Tighten here with a DB lookup if stricter isolation is needed.
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[collab] authenticated y-websocket listening on ${HOST}:${PORT}`);
});
