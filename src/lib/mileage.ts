// Own-car claims: the amount is the round-trip distance times a rate per km (pure helpers; the route search is src/lib/route-distance.ts).

export const DEFAULT_RATE_PER_KM = 20;
export const MAX_RATE_PER_KM = 1000;
export const MAX_ONE_WAY_KM = 1000;
export const MAX_ADDRESS_LENGTH = 300;

export type MileageSource = 'google' | 'manual';

/** The rate setting as a number: a whole number of yen from 1 up, otherwise the default. */
export function parseRate(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_RATE_PER_KM ? n : DEFAULT_RATE_PER_KM;
}

/** Round trip = twice the one-way route, in metres, rounded to 100 m (the claim shows km with one decimal). */
export function roundTripMeters(oneWayMeters: number): number {
  return Math.round((oneWayMeters * 2) / 100) * 100;
}

export const metersToKm = (m: number) => Math.round(m / 100) / 10;

/** The claim amount: km (one decimal) x rate, rounded to a whole yen. */
export function mileageAmount(roundTripM: number, ratePerKm: number): number {
  return Math.round(metersToKm(roundTripM) * ratePerKm);
}

export function summarizeMileage(oneWayMeters: number, ratePerKm: number) {
  const roundTripM = roundTripMeters(oneWayMeters);
  return { one_way_km: metersToKm(oneWayMeters), round_trip_m: roundTripM, round_trip_km: metersToKm(roundTripM), rate_per_km: ratePerKm, amount: mileageAmount(roundTripM, ratePerKm) };
}

/** A link that shows the same route in Google Maps, so a reviewer can check it with one click. */
export function mapsLink(origin: string, destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}
