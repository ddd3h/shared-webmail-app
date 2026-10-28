import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { homeAddressOf, mileageRate } from '@/lib/mileage-server';
import { routeServiceEnabled } from '@/lib/route-distance';

// GET /api/expenses/mileage - what the own-car form needs: the current rate, whether routes are searched, and the person's home address
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const [rate, service, home] = await Promise.all([mileageRate(), routeServiceEnabled(), homeAddressOf(session.userId)]);
  return NextResponse.json({ rate_per_km: rate, route_service: service, home_address: home });
}
