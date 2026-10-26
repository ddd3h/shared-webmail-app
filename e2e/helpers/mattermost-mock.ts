import http from 'http';
import { MM_PORT, MM_URL } from './constants';

type Post = { to: string; message: string };

// Minimal stand-in for the Mattermost REST API used by src/lib/mattermost-dm.ts.
// It runs in the global-setup process; specs talk to it over HTTP (see mm below).
export function startMattermostMock(): Promise<() => Promise<void>> {
  const posts: Post[] = [];
  const channelTarget = new Map<string, string>();
  let failPosts = false;
  let imageHits = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const url = req.url || '';
      const send = (o: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/__posts') return send(posts);
      if (url === '/__reset') { posts.length = 0; failPosts = false; imageHits = 0; return send({ ok: true }); }
      if (url === '/__image_hits') return send({ hits: imageHits });
      if (/^\/api\/v4\/users\/[^/]+\/image$/.test(url)) { imageHits++; res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')); }
      if (url === '/__fail') { failPosts = JSON.parse(body || '{}').on !== false; return send({ failPosts }); }
      if (url === '/api/v4/users/me') return send({ id: 'bot-id' });
      if (url.startsWith('/api/v4/users/email/')) return send({ id: 'mm-' + decodeURIComponent(url.split('/').pop()!).split('@')[0] });
      if (url === '/api/v4/channels/direct') {
        const [, other] = JSON.parse(body);
        channelTarget.set('ch-' + other, other);
        return send({ id: 'ch-' + other });
      }
      if (url === '/api/v4/posts') {
        if (failPosts) return send({ error: 'down' }, 500);
        const p = JSON.parse(body);
        posts.push({ to: channelTarget.get(p.channel_id) ?? p.channel_id, message: p.message });
        return send({ id: 'post' + posts.length });
      }
      send({ error: 'unknown' }, 404);
    });
  });
  return new Promise(resolve => server.listen(MM_PORT, () => resolve(() => new Promise(r => server.close(() => r())))));
}

// Used from specs.
export const mm = {
  async posts(): Promise<Post[]> { return (await fetch(`${MM_URL}/__posts`)).json(); },
  // How many times a profile picture was fetched from (the fake) Mattermost
  async imageHits(): Promise<number> { return (await (await fetch(`${MM_URL}/__image_hits`)).json()).hits; },
  async reset() { await fetch(`${MM_URL}/__reset`, { method: 'POST' }); },
  async fail(on = true) { await fetch(`${MM_URL}/__fail`, { method: 'POST', body: JSON.stringify({ on }) }); },
  // DMs are sent after the HTTP response, so poll briefly.
  async waitFor(match: (p: Post) => boolean, timeoutMs = 8000): Promise<Post[]> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const found = (await this.posts()).filter(match);
      if (found.length > 0 || Date.now() > end) return found;
      await new Promise(r => setTimeout(r, 150));
    }
  },
  // For asserting that nothing was sent: wait a moment, then look.
  async quiet(ms = 1500): Promise<Post[]> { await new Promise(r => setTimeout(r, ms)); return this.posts(); },
};
