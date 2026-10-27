// DB-side helpers for own-car claims, shared by the expense routes.
import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { drivingDistance, routeServiceEnabled } from '@/lib/route-distance';
import { MAX_ADDRESS_LENGTH, MAX_ONE_WAY_KM, mileageAmount, parseRate, roundTripMeters, type MileageSource } from '@/lib/mileage';

export const mileageRate = async () => parseRate(await getSetting('MILEAGE_RATE_PER_KM'));

export type MileageInput = { destination: string; manual_one_way_km?: number };
export type MileageData = { origin: string; destination: string; one_way_m: number; distance_m: number; rate: number; source: MileageSource; amount: number };
export type MileageError = { error: 'home_not_set' | 'route_not_found' | 'route_failed' | 'manual_not_allowed' | 'distance_required'; status: number };

export async function homeAddressOf(userId: string): Promise<string | null> {
  const u = await prisma.users.findUnique({ where: { id: userId }, select: { home_address: true } });
  return u?.home_address?.trim() || null;
}

/**
 * Works out a claim: from the person's home to the destination, there and back, at the current rate.
 * A typed-in distance is accepted only while no route service is set up (otherwise the route is always searched).
 */
export async function resolveMileage(userId: string, input: MileageInput): Promise<MileageData | MileageError> {
  const origin = await homeAddressOf(userId);
  if (!origin) return { error: 'home_not_set', status: 400 };
  const destination = input.destination.trim().slice(0, MAX_ADDRESS_LENGTH);
  const rate = await mileageRate();
  let oneWay: number;
  let source: MileageSource;
  if (await routeServiceEnabled()) {
    if (input.manual_one_way_km !== undefined) return { error: 'manual_not_allowed', status: 400 };
    const r = await drivingDistance(origin, destination);
    if (!r.ok) return r.reason === 'not_found' ? { error: 'route_not_found', status: 422 } : { error: 'route_failed', status: 502 };
    oneWay = r.meters; source = 'google';
  } else {
    const km = input.manual_one_way_km;
    if (km === undefined) return { error: 'distance_required', status: 400 };
    if (!(km > 0 && km <= MAX_ONE_WAY_KM)) return { error: 'distance_required', status: 400 };
    oneWay = Math.round(km * 1000); source = 'manual';
  }
  const distance_m = roundTripMeters(oneWay);
  return { origin, destination, one_way_m: oneWay, distance_m, rate, source, amount: Math.max(1, mileageAmount(distance_m, rate)) };
}

export const isMileageError = (r: MileageData | MileageError): r is MileageError => 'error' in r;
