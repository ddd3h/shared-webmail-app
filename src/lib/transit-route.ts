// The best public-transport route between two places, from Google's Routes API (TRANSIT). Needs the Google Maps key and the "Googleマップ" way of
// finding distances (see route-distance.ts); otherwise the person is shown links to Yahoo!乗換案内 / Google Maps instead.
// Fares are shown only when Google has them (it often has not for Japanese lines).
import { mapsApiKey, routeBaseUrl, routeProvider } from '@/lib/route-distance';
import type { TransitRoute, TransitStep } from '@/lib/transit';

export type TransitResult = { ok: true; route: TransitRoute } | { ok: false; reason: 'not_available' | 'not_found' | 'failed' };

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; route: TransitRoute }>();
export const clearTransitCache = () => cache.clear();
/** Can the route be shown in the app: the Google Maps way of searching, with its key. */
export async function transitInApp() { return !!(await mapsApiKey()) && (await routeProvider()) === 'google'; }

const seconds = (s: unknown) => (typeof s === 'string' ? parseInt(s, 10) || 0 : 0);
const minutes = (s: unknown) => Math.max(1, Math.round(seconds(s) / 60));

type Step = { travelMode?: string; staticDuration?: string; transitDetails?: { stopDetails?: { departureStop?: { name?: string }; arrivalStop?: { name?: string } }; transitLine?: { name?: string; nameShort?: string }; stopCount?: number } };

export function parseTransitRoute(json: unknown): TransitRoute | null {
  const r = (json as { routes?: { duration?: string; legs?: { steps?: Step[] }[]; travelAdvisory?: { transitFare?: { currencyCode?: string; units?: string | number; nanos?: number } } }[] } | null)?.routes?.[0];
  if (!r) return null;
  const steps: TransitStep[] = (r.legs ?? []).flatMap(l => l.steps ?? []).flatMap((s): TransitStep[] => {
    if (s.travelMode === 'TRANSIT' && s.transitDetails) {
      const t = s.transitDetails;
      return [{ kind: 'transit', minutes: minutes(s.staticDuration), line: t.transitLine?.name || t.transitLine?.nameShort, from: t.stopDetails?.departureStop?.name, to: t.stopDetails?.arrivalStop?.name, stops: t.stopCount }];
    }
    return s.travelMode === 'WALK' && seconds(s.staticDuration) >= 60 ? [{ kind: 'walk', minutes: minutes(s.staticDuration) }] : [];
  });
  const fare = r.travelAdvisory?.transitFare;
  const yen = fare && (fare.currencyCode ?? 'JPY') === 'JPY' ? Number(fare.units) : NaN;
  return {
    minutes: minutes(r.duration), transfers: Math.max(0, steps.filter(s => s.kind === 'transit').length - 1),
    fare_yen: Number.isFinite(yen) && yen > 0 ? yen : null, steps, summary: '',
  };
}

export async function transitRoute(from: string, to: string, departure?: Date): Promise<TransitResult> {
  const key = await mapsApiKey();
  if (!key || !(await transitInApp())) return { ok: false, reason: 'not_available' };
  const ck = `${from}\n${to}\n${departure?.toISOString().slice(0, 13) ?? ''}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, route: hit.route };
  try {
    const res = await fetch(`${routeBaseUrl()}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.duration,routes.travelAdvisory.transitFare,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.transitDetails',
      },
      body: JSON.stringify({
        origin: { address: from }, destination: { address: to }, travelMode: 'TRANSIT', languageCode: 'ja-JP', regionCode: 'JP',
        // a time in the past is refused by the service: only a time that is still ahead is sent (otherwise "now")
        ...(departure && departure.getTime() > Date.now() + 60_000 ? { departureTime: departure.toISOString() } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (res.status === 404 || (res.status === 400 && /geocod|not found|address/i.test(json?.error?.message ?? ''))) return { ok: false, reason: 'not_found' };
    if (!res.ok) { console.error('[transit] http', res.status, json?.error?.message); return { ok: false, reason: 'failed' }; }
    const route = parseTransitRoute(json);
    if (!route) return { ok: false, reason: 'not_found' };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(ck, { at: Date.now(), route });
    return { ok: true, route };
  } catch (e) {
    console.error('[transit] failed:', (e as Error)?.message || e);
    return { ok: false, reason: 'failed' };
  }
}
