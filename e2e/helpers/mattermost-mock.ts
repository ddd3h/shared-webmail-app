import http from 'http';
import { MM_PORT, MM_URL } from './constants';

type Post = { to: string; message: string };

// Stand-in for an OpenAI-compatible /embeddings service: a word of a "concept" lights up that concept's dimension,
// so texts about the same thing are close even when they share no word. Text with no known word gets the zero vector.
const CONCEPTS = [
  ['請求書', 'インボイス', '支払い', '代金', '振込'],
  ['打ち合わせ', '会議', 'ミーティング', '日程'],
  ['見積', '見積もり', '御見積', 'お見積り'],
  ['採用', '面接', '応募'],
];
export function fakeEmbedding(text: string): number[] {
  return CONCEPTS.map(words => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0));
}

// Minimal stand-in for the Mattermost REST API used by src/lib/mattermost-dm.ts.
// It runs in the global-setup process; specs talk to it over HTTP (see mm below).
export function startMattermostMock(): Promise<() => Promise<void>> {
  const posts: Post[] = [];
  const channelTarget = new Map<string, string>();
  let failPosts = false;
  let imageHits = 0;
  let failEmbeddings = false;
  let embeddingCalls = 0;
  let mapsCalls = 0;
  let failMaps: 'down' | 'denied' | null = null;
  let lastMaps: { key: string; origin?: string; destination?: string; mode?: string } | null = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const url = req.url || '';
      const send = (o: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/__posts') return send(posts);
      if (url === '/__reset') { posts.length = 0; failPosts = false; imageHits = 0; failEmbeddings = false; embeddingCalls = 0; mapsCalls = 0; failMaps = null; lastMaps = null; return send({ ok: true }); }
      if (url === '/__fail_embeddings') { failEmbeddings = JSON.parse(body || '{}').on !== false; return send({ failEmbeddings }); }
      if (url === '/__embedding_calls') return send({ calls: embeddingCalls });
      if (url === '/v1/embeddings') {
        embeddingCalls++;
        if (failEmbeddings) return send({ error: 'down' }, 503);
        const { input } = JSON.parse(body) as { input: string[] };
        return send({ data: input.map((t, index) => ({ index, embedding: fakeEmbedding(t) })) });
      }
      if (url === '/__maps_calls') return send({ calls: mapsCalls, last: lastMaps });
      if (url === '/__fail_maps') { failMaps = JSON.parse(body || '{}').mode ?? null; return send({ failMaps }); }
      if (url === '/maps/directions/v2:computeRoutes') {
        mapsCalls++;
        const parsed = JSON.parse(body || '{}');
        lastMaps = { key: String(req.headers['x-goog-api-key'] ?? ''), origin: parsed.origin?.address, destination: parsed.destination?.address, mode: parsed.travelMode };
        if (failMaps === 'down') return send({ error: { status: 'UNAVAILABLE', message: 'down' } }, 503);
        if (failMaps === 'denied') return send({ error: { status: 'PERMISSION_DENIED', message: 'API key not valid' } }, 400);
        const dest: string = parsed.destination?.address ?? '';
        if (/見つからない/.test(dest)) return send({ error: { status: 'NOT_FOUND', message: 'Address not found (geocoding failed)' } }, 404);
        // stand-in distances: 新宿 12.34 km, 横浜 35.0 km, anything else 8.0 km
        const meters = /新宿/.test(dest) ? 12340 : /横浜/.test(dest) ? 35000 : 8000;
        return send({ routes: [{ distanceMeters: meters }] });
      }
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
  async failEmbeddings(on = true) { await fetch(`${MM_URL}/__fail_embeddings`, { method: 'POST', body: JSON.stringify({ on }) }); },
  async embeddingCalls(): Promise<number> { return (await (await fetch(`${MM_URL}/__embedding_calls`)).json()).calls; },
  async mapsCalls(): Promise<{ calls: number; last: { key: string; origin?: string; destination?: string; mode?: string } | null }> { return (await fetch(`${MM_URL}/__maps_calls`)).json(); },
  async failMaps(mode: 'down' | 'denied' | null) { await fetch(`${MM_URL}/__fail_maps`, { method: 'POST', body: JSON.stringify({ mode }) }); },
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
