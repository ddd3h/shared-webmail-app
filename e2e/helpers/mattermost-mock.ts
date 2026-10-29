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
  // stand-ins for the free route search: 国土地理院 address search, Nominatim, OSRM
  const osm = { gsi: [] as string[], nominatim: [] as { q: string; ua: string }[], osrm: [] as string[], uas: [] as string[] };
  let failOsm: 'gsi' | 'nominatim' | 'osrm' | 'noroute' | null = null;
  // places the stand-ins know: [lon, lat]; the route length depends on where it ends
  const PLACES: Record<string, [number, number]> = { 丸の内: [139.764, 35.6812], 新宿: [139.6917, 35.6895], 横浜: [139.638, 35.4437] };
  const NAMED: Record<string, [number, number]> = { 東京タワー: [139.7454, 35.6586] };
  const OSRM_METERS = (lon: number) => (Math.abs(lon - 139.6917) < 1e-4 ? 12340 : Math.abs(lon - 139.638) < 1e-4 ? 35000 : Math.abs(lon - 139.7454) < 1e-4 ? 8000 : 5000);
  // a stand-in for freee: OAuth (authorize / token), companies, bank accounts, accounts, and deals
  const FREEE = { id: 'e2e-freee-id', secret: 'e2e-freee-secret', code: 'e2e-freee-code' };
  let freeeSeq = 0;
  let freeeAccess = '';
  let freeeRefresh = '';
  let freeeTokenCalls: string[] = [];
  let freeeDeals: any[] = [];
  let freeeReceipts: any[] = [];   // 証憑 uploaded to the ファイルボックス
  let failFreee: 'down' | 'invalid' | 'receipt' | 'receipt_second' | null = null;
  let freeeCompanies = 1;
  let failMaps: 'down' | 'denied' | null = null;
  let lastMaps: { key: string; origin?: string; destination?: string; mode?: string; departureTime?: string } | null = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => (body += d));
    req.on('end', () => {
      const url = req.url || '';
      const send = (o: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (url === '/__posts') return send(posts);
      if (url === '/__reset') { posts.length = 0; failPosts = false; imageHits = 0; failEmbeddings = false; embeddingCalls = 0; mapsCalls = 0; failMaps = null; lastMaps = null; osm.gsi = []; osm.nominatim = []; osm.osrm = []; osm.uas = []; failOsm = null; freeeAccess = ''; freeeRefresh = ''; freeeTokenCalls = []; freeeDeals = []; freeeReceipts = []; failFreee = null; freeeCompanies = 1; return send({ ok: true }); }
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
        lastMaps = { key: String(req.headers['x-goog-api-key'] ?? ''), origin: parsed.origin?.address, destination: parsed.destination?.address, mode: parsed.travelMode, departureTime: parsed.departureTime };
        if (parsed.travelMode === 'TRANSIT') {
          // public transport: 新宿 has a fare and two legs, 運賃なし has none, 見つからない is unknown
          const to: string = parsed.destination?.address ?? '';
          if (failMaps === 'down') return send({ error: { status: 'UNAVAILABLE', message: 'down' } }, 503);
          if (/見つからない/.test(to)) return send({ error: { status: 'NOT_FOUND', message: 'Address not found (geocoding failed)' } }, 404);
          const walk = { travelMode: 'WALK', staticDuration: '300s' };
          const ride = (line: string, a: string, b: string, secs: number, stops: number) => ({ travelMode: 'TRANSIT', staticDuration: `${secs}s`, transitDetails: { stopDetails: { departureStop: { name: a }, arrivalStop: { name: b } }, transitLine: { name: line, nameShort: line }, stopCount: stops } });
          const steps = /新宿/.test(to) ? [walk, ride('JR埼京線', '川越', '赤羽', 1500, 8), ride('JR山手線', '赤羽', '新宿', 900, 6), walk] : [walk, ride('東京メトロ丸ノ内線', '東京', to, 1200, 7)];
          const fare = /運賃なし/.test(to) || !/新宿/.test(to) ? {} : { travelAdvisory: { transitFare: { currencyCode: 'JPY', units: '590' } } };
          const total = (st: { staticDuration: string }[]) => `${st.reduce((s, x) => s + parseInt(x.staticDuration, 10), 0)}s`;
          const routes = [{ duration: total(steps), legs: [{ steps }], ...fare }];
          if (parsed.computeAlternativeRoutes && /新宿/.test(to) && !/運賃なし/.test(to)) {
            // two more candidates: no change of trains but longer, and a cheaper one with a long walk
            const direct = [walk, ride('JR川越線直通 埼京線', '川越', '新宿', 2700, 14), walk];
            const cheap = [{ travelMode: 'WALK', staticDuration: '900s' }, ride('東武東上線', '川越', '池袋', 2400, 11), ride('JR山手線', '池袋', '新宿', 420, 2), walk];
            routes.push({ duration: total(direct), legs: [{ steps: direct }], ...fare }, { duration: total(cheap), legs: [{ steps: cheap }], travelAdvisory: { transitFare: { currencyCode: 'JPY', units: '480' } } });
            routes.push({ duration: total(steps), legs: [{ steps }], ...fare }); // Google repeats a route now and then: it must be shown once
          }
          return send({ routes });
        }
        if (failMaps === 'down') return send({ error: { status: 'UNAVAILABLE', message: 'down' } }, 503);
        if (failMaps === 'denied') return send({ error: { status: 'PERMISSION_DENIED', message: 'API key not valid' } }, 400);
        const dest: string = parsed.destination?.address ?? '';
        if (/見つからない/.test(dest)) return send({ error: { status: 'NOT_FOUND', message: 'Address not found (geocoding failed)' } }, 404);
        // stand-in distances: 新宿 12.34 km, 横浜 35.0 km, anything else 8.0 km
        const meters = /新宿/.test(dest) ? 12340 : /横浜/.test(dest) ? 35000 : 8000;
        return send({ routes: [{ distanceMeters: meters }] });
      }
      if (url === '/__osm_state') return send(osm);
      if (url === '/__fail_osm') { failOsm = JSON.parse(body || '{}').mode ?? null; return send({ failOsm }); }
      if (url.startsWith('/gsi/address-search/AddressSearch')) {
        const q = new URL(url, 'http://x').searchParams.get('q') || '';
        osm.gsi.push(q); osm.uas.push(String(req.headers['user-agent'] ?? ''));
        if (failOsm === 'gsi') return send({ error: 'down' }, 503);
        const hit = Object.entries(PLACES).find(([k]) => q.includes(k));
        return send(hit ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: hit[1] }, properties: { title: q } }] : []);
      }
      if (url.startsWith('/nominatim/search')) {
        const q = new URL(url, 'http://x').searchParams.get('q') || '';
        osm.nominatim.push({ q, ua: String(req.headers['user-agent'] ?? '') });
        if (failOsm === 'nominatim') return send({ error: 'down' }, 503);
        const hit = Object.entries(NAMED).find(([k]) => q.includes(k));
        return send(hit ? [{ lat: String(hit[1][1]), lon: String(hit[1][0]), display_name: q }] : []);
      }
      if (url.startsWith('/osrm/route/v1/driving/')) {
        osm.osrm.push(url);
        if (failOsm === 'osrm') return send({ code: 'Error' }, 503);
        if (failOsm === 'noroute') return send({ code: 'NoRoute', message: 'Impossible route' }, 200);
        const [, b] = decodeURIComponent(url.split('/driving/')[1].split('?')[0]).split(';');
        const lon = Number(b.split(',')[0]);
        return send({ code: 'Ok', routes: [{ distance: OSRM_METERS(lon), duration: 600 }] });
      }
      if (url === '/__freee_state') return send({ deals: freeeDeals, receipts: freeeReceipts, tokenCalls: freeeTokenCalls, access: freeeAccess });
      if (url === '/__freee_fail') { failFreee = JSON.parse(body || '{}').mode ?? null; return send({ failFreee }); }
      if (url === '/__freee_companies') { freeeCompanies = JSON.parse(body || '{}').n ?? 1; return send({ freeeCompanies }); }
      if (url === '/__freee_expire') { freeeAccess = ''; return send({ ok: true }); } // the access token stops working (the refresh token still does)
      if (url.startsWith('/freee-auth/public_api/authorize')) {
        const q = new URL(url, 'http://x').searchParams;
        const back = new URL(q.get('redirect_uri') || 'http://localhost');
        if (q.get('client_id') !== FREEE.id) { res.writeHead(400); return res.end('bad client'); }
        back.searchParams.set('code', FREEE.code); back.searchParams.set('state', q.get('state') || '');
        res.writeHead(302, { Location: back.toString() }); return res.end();
      }
      if (url === '/freee-auth/public_api/token') {
        const f = new URLSearchParams(body);
        freeeTokenCalls.push(f.get('grant_type') || '');
        const okClient = f.get('client_id') === FREEE.id && f.get('client_secret') === FREEE.secret;
        const okGrant = (f.get('grant_type') === 'authorization_code' && f.get('code') === FREEE.code) || (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === freeeRefresh && freeeRefresh !== '');
        if (!okClient || !okGrant) return send({ error: 'invalid_grant', error_description: 'bad grant' }, 401);
        freeeSeq++; freeeAccess = `at-${freeeSeq}`; freeeRefresh = `rt-${freeeSeq}`;   // the refresh token works once
        return send({ access_token: freeeAccess, token_type: 'Bearer', expires_in: 86400, refresh_token: freeeRefresh, scope: 'read write', created_at: 0 });
      }
      if (url.startsWith('/freee-api/')) {
        if (req.headers.authorization !== `Bearer ${freeeAccess}` || !freeeAccess) return send({ message: 'unauthorized' }, 401);
        const path = url.slice('/freee-api'.length).split('?')[0];
        if (path === '/api/1/companies') return send({ companies: [{ id: 111, name: 'テスト株式会社', display_name: 'テスト株式会社' }, { id: 222, name: '別会社', display_name: '別会社' }].slice(0, freeeCompanies) });
        if (path === '/api/1/walletables') return send({ walletables: [{ id: 501, name: 'みずほ銀行 普通', type: 'bank_account' }, { id: 502, name: '現金', type: 'wallet' }] });
        if (path === '/api/1/account_items') return send({ account_items: [{ id: 9001, name: '給料手当' }, { id: 9002, name: '役員報酬' }, { id: 9003, name: '外注費' }, { id: 9004, name: '買掛金' }, { id: 9005, name: '旅費交通費' }, { id: 9006, name: '交際費' }] });
        if (path === '/api/1/receipts' && req.method === 'POST') {
          if (failFreee === 'receipt_second' && freeeReceipts.length === 1) return send({ message: 'unavailable' }, 500);   // only the second upload fails
          if (failFreee === 'down' || failFreee === 'receipt') return send({ message: 'unavailable' }, failFreee === 'down' ? 503 : 500);
          // multipart: the fields are read out of the raw text (the file's bytes are not needed)
          const field = (name: string) => new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)').exec(body)?.[1];
          const file = /name="receipt"; filename="([^"]*)"/.exec(body);
          if (!file || !/multipart\/form-data/.test(String(req.headers['content-type'] ?? ''))) return send({ message: 'invalid receipt' }, 400);
          const company = field('company_id'); const description = field('description'); const issue = field('issue_date');
          if (!company || !issue) return send({ message: 'invalid receipt' }, 400);
          const receipt = { id: 8000 + freeeReceipts.length + 1, filename: file[1], company_id: Number(company), description: description ?? '', issue_date: issue, size: body.length };
          freeeReceipts.push(receipt);
          return send({ receipt: { id: receipt.id } });
        }
        if (path === '/api/1/deals' && req.method === 'POST') {
          if (failFreee === 'down') return send({ message: 'unavailable' }, 503);
          const deal = JSON.parse(body || '{}');
          if (failFreee === 'invalid') return send({ status_code: 400, errors: [{ type: 'status', messages: ['勘定科目が不正です'] }] }, 400);
          if ((deal.receipt_ids ?? []).some((id: number) => !freeeReceipts.some(r => r.id === id))) return send({ message: 'unknown receipt' }, 400);
          const total = (deal.details ?? []).reduce((s: number, x: any) => s + x.amount, 0);
          if (deal.type !== 'expense' || !deal.company_id || !deal.issue_date || !(deal.details ?? []).length || (deal.payments ?? []).reduce((s: number, x: any) => s + x.amount, 0) !== total) return send({ message: 'invalid deal' }, 400);
          freeeDeals.push({ ...deal, id: 7000 + freeeDeals.length + 1, version: req.headers['x-api-version'] });
          return send({ deal: { id: 7000 + freeeDeals.length } });
        }
        return send({ message: 'not found' }, 404);
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
  async mapsCalls(): Promise<{ calls: number; last: { key: string; origin?: string; destination?: string; mode?: string; departureTime?: string } | null }> { return (await fetch(`${MM_URL}/__maps_calls`)).json(); },
  async failMaps(mode: 'down' | 'denied' | null) { await fetch(`${MM_URL}/__fail_maps`, { method: 'POST', body: JSON.stringify({ mode }) }); },
  osm: {
    async state(): Promise<{ gsi: string[]; nominatim: { q: string; ua: string }[]; osrm: string[]; uas: string[] }> { return (await fetch(`${MM_URL}/__osm_state`)).json(); },
    async fail(mode: 'gsi' | 'nominatim' | 'osrm' | 'noroute' | null) { await fetch(`${MM_URL}/__fail_osm`, { method: 'POST', body: JSON.stringify({ mode }) }); },
  },
  freee: {
    async state(): Promise<{ deals: any[]; receipts: any[]; tokenCalls: string[]; access: string }> { return (await fetch(`${MM_URL}/__freee_state`)).json(); },
    async fail(mode: 'down' | 'invalid' | 'receipt' | 'receipt_second' | null) { await fetch(`${MM_URL}/__freee_fail`, { method: 'POST', body: JSON.stringify({ mode }) }); },
    async companies(n: number) { await fetch(`${MM_URL}/__freee_companies`, { method: 'POST', body: JSON.stringify({ n }) }); },
    async expireAccessToken() { await fetch(`${MM_URL}/__freee_expire`, { method: 'POST' }); },
  },
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
