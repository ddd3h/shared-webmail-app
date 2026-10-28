// The driving distance between two places. Three ways, chosen by the administrator (ROUTE_PROVIDER):
//  - google: Google's Routes API, the route Google recommends. Needs a Google Maps API key (billed by Google).
//  - osm:    free, no key. The addresses are found with the Geospatial Information Authority of Japan's address search (国土地理院),
//            then OpenStreetMap's Nominatim for places that are not an address (facility names); the route is OSRM's, over OpenStreetMap roads.
//            The public servers are meant for light use (a few searches a day is fine); a server of your own can be set (OSRM_BASE_URL).
//  - manual: nothing is searched; the person types the one-way distance.
// Without a choice: google when a key is set, otherwise osm. MAPS_API_URL / GSI_URL / NOMINATIM_URL / OSRM_URL replace the addresses (the tests use stand-ins).
import { getSetting } from '@/lib/settings';
import type { RouteProvider } from '@/lib/mileage';

export type RouteResult = { ok: true; meters: number } | { ok: false; reason: 'not_found' | 'failed' };

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX = 500;
// The same pair is asked again when a claim is edited or sent: remembered for an hour (each search is billed by Google, and the free services ask for light use).
const cache = new Map<string, { at: number; meters: number }>();
const geoCache = new Map<string, { at: number; point: Point }>();
type Point = { lon: number; lat: number };

export const routeBaseUrl = () => (process.env.MAPS_API_URL?.trim() || 'https://routes.googleapis.com').replace(/\/+$/, '');
export async function mapsApiKey(): Promise<string | null> {
  return (await getSetting('GOOGLE_MAPS_API_KEY'))?.trim() || null;
}

/** The way distances are found now: the chosen one, google only while a key is there. */
export async function routeProvider(): Promise<RouteProvider> {
  const [chosen, key] = await Promise.all([getSetting('ROUTE_PROVIDER'), mapsApiKey()]);
  if (chosen === 'manual') return 'manual';
  if (chosen === 'osm') return 'osm';
  return key ? 'google' : 'osm';
}
export const routeServiceEnabled = async () => (await routeProvider()) !== 'manual';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

async function googleDistance(originAddress: string, destination: string): Promise<RouteResult> {
  const key = await mapsApiKey();
  if (!key) return { ok: false, reason: 'failed' };
  const o = norm(originAddress), d = norm(destination);
  const ck = `g|${o}\n${d}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, meters: hit.meters };
  try {
    const res = await fetch(`${routeBaseUrl()}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters' },
      body: JSON.stringify({ origin: { address: o }, destination: { address: d }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'ja-JP', regionCode: 'JP' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 400) {
      // an address Google cannot find answers 400/404 (INVALID_ARGUMENT / NOT_FOUND); a wrong key answers 400 too, so look at the words
      const body = await res.json().catch(() => null) as { error?: { status?: string; message?: string } } | null;
      if (body?.error?.status === 'NOT_FOUND' || /geocod|not found|address/i.test(body?.error?.message ?? '')) return { ok: false, reason: 'not_found' };
      console.error('[route] request refused:', body?.error?.message ?? res.status);
      return { ok: false, reason: 'failed' };
    }
    if (!res.ok) { console.error('[route] http', res.status); return { ok: false, reason: 'failed' }; }
    const json = await res.json().catch(() => null) as { routes?: { distanceMeters?: number }[] } | null;
    const meters = json?.routes?.[0]?.distanceMeters;
    if (typeof meters !== 'number' || !Number.isFinite(meters)) return { ok: false, reason: 'not_found' };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(ck, { at: Date.now(), meters });
    return { ok: true, meters };
  } catch (e) {
    console.error('[route] failed:', (e as Error)?.message || e);
    return { ok: false, reason: 'failed' };
  }
}

// ---- OpenStreetMap ----

const gsiUrl = () => (process.env.GSI_URL?.trim() || 'https://msearch.gsi.go.jp').replace(/\/+$/, '');
const nominatimUrl = () => (process.env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
async function osrmUrl() {
  return ((await getSetting('OSRM_BASE_URL'))?.trim() || process.env.OSRM_URL?.trim() || 'https://router.project-osrm.org').replace(/\/+$/, '');
}
const userAgent = () => `shared-webmail-app/1.0 (${process.env.NEXT_PUBLIC_APP_URL || 'self-hosted'})`;

// Nominatim asks for at most one request a second: they are queued, a little over a second apart.
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;
function nominatimSlot<T>(run: () => Promise<T>): Promise<T> {
  const next = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    return run();
  });
  nominatimQueue = next.catch(() => undefined);
  return next;
}

/** An address -> a point: the 国土地理院 address search first, then Nominatim for names of places. */
async function geocode(text: string): Promise<{ ok: true; point: Point } | { ok: false; reason: 'not_found' | 'failed' }> {
  const q = norm(text);
  const hit = geoCache.get(q);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS * 24) return { ok: true, point: hit.point };
  let failed = false;
  const remember = (point: Point) => {
    if (geoCache.size >= CACHE_MAX) geoCache.delete(geoCache.keys().next().value as string);
    geoCache.set(q, { at: Date.now(), point });
    return { ok: true as const, point };
  };
  try {
    const res = await fetch(`${gsiUrl()}/address-search/AddressSearch?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const j = await res.json().catch(() => null) as { geometry?: { coordinates?: number[] } }[] | null;
      const c = Array.isArray(j) ? j[0]?.geometry?.coordinates : undefined;
      if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) return remember({ lon: c[0], lat: c[1] });
    } else failed = true;
  } catch (e) { failed = true; console.error('[route] gsi failed:', (e as Error)?.message || e); }
  try {
    const url = `${nominatimUrl()}/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&countrycodes=jp&accept-language=ja`;
    const res = await nominatimSlot(() => fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
    if (res.ok) {
      const j = await res.json().catch(() => null) as { lat?: string; lon?: string }[] | null;
      const lat = Number(j?.[0]?.lat), lon = Number(j?.[0]?.lon);
      if (Array.isArray(j) && Number.isFinite(lat) && Number.isFinite(lon)) return remember({ lon, lat });
      return { ok: false, reason: failed ? 'failed' : 'not_found' };
    }
    return { ok: false, reason: 'failed' };
  } catch (e) {
    console.error('[route] nominatim failed:', (e as Error)?.message || e);
    return { ok: false, reason: 'failed' };
  }
}

async function osmDistance(originAddress: string, destination: string): Promise<RouteResult> {
  const o = norm(originAddress), d = norm(destination);
  const ck = `o|${o}\n${d}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, meters: hit.meters };
  const from = await geocode(o);
  if (!from.ok) return from;
  const to = await geocode(d);
  if (!to.ok) return to;
  try {
    const url = `${await osrmUrl()}/route/v1/driving/${from.point.lon},${from.point.lat};${to.point.lon},${to.point.lat}?overview=false&alternatives=false`;
    const res = await fetch(url, { headers: { 'User-Agent': userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await res.json().catch(() => null) as { code?: string; routes?: { distance?: number }[] } | null;
    if (j?.code === 'NoRoute') return { ok: false, reason: 'not_found' };
    const meters = j?.routes?.[0]?.distance;
    if (!res.ok || j?.code !== 'Ok' || typeof meters !== 'number' || !Number.isFinite(meters)) { console.error('[route] osrm answered', res.status, j?.code); return { ok: false, reason: 'failed' }; }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(ck, { at: Date.now(), meters });
    return { ok: true, meters };
  } catch (e) {
    console.error('[route] osrm failed:', (e as Error)?.message || e);
    return { ok: false, reason: 'failed' };
  }
}

/** The driving distance one way, by the way the administrator chose; `source` says which one answered. */
export async function drivingDistance(originAddress: string, destination: string): Promise<RouteResult & { source?: 'google' | 'osm' }> {
  const provider = await routeProvider();
  if (provider === 'manual') return { ok: false, reason: 'failed' };
  const r = provider === 'google' ? await googleDistance(originAddress, destination) : await osmDistance(originAddress, destination);
  return r.ok ? { ...r, source: provider } : r;
}

export const clearRouteCache = () => { cache.clear(); geoCache.clear(); };
