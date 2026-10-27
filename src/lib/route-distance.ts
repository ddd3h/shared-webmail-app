// The driving distance between two places, from Google's Routes API (the route Google recommends, "the best route").
// Off until an administrator sets a Google Maps API key (the admin screen, or GOOGLE_MAPS_API_KEY in the environment).
// MAPS_API_URL replaces the address of the service (the tests use a stand-in).
import { getSetting } from '@/lib/settings';

export type RouteResult = { ok: true; meters: number } | { ok: false; reason: 'not_found' | 'failed' };

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX = 500;
// The same pair is asked again when a claim is edited or sent: remembered for an hour (each search is billed by Google).
const cache = new Map<string, { at: number; meters: number }>();

export const routeBaseUrl = () => (process.env.MAPS_API_URL?.trim() || 'https://routes.googleapis.com').replace(/\/+$/, '');
export async function mapsApiKey(): Promise<string | null> {
  return (await getSetting('GOOGLE_MAPS_API_KEY'))?.trim() || null;
}
export const routeServiceEnabled = async () => (await mapsApiKey()) !== null;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function drivingDistance(originAddress: string, destination: string): Promise<RouteResult> {
  const key = await mapsApiKey();
  if (!key) return { ok: false, reason: 'failed' };
  const o = norm(originAddress), d = norm(destination);
  const ck = `${o}\n${d}`;
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

export const clearRouteCache = () => cache.clear();
