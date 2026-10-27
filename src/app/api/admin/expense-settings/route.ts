import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { setSetting } from '@/lib/settings';
import { MAX_RATE_PER_KM } from '@/lib/mileage';
import { mileageRate } from '@/lib/mileage-server';
import { clearRouteCache, mapsApiKey } from '@/lib/route-distance';

// GET /api/admin/expense-settings - the rate per km for own-car claims, and whether a Google Maps key is set (the key itself is never sent back)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  return NextResponse.json({ rate_per_km: await mileageRate(), maps_api_key_set: (await mapsApiKey()) !== null });
}

const schema = z.object({
  rate_per_km: z.number().int().min(1).max(MAX_RATE_PER_KM).optional(),
  // undefined = keep, '' = remove the key (routes are no longer searched)
  maps_api_key: z.string().trim().max(200).optional(),
});

// PUT /api/admin/expense-settings. A new rate applies to claims sent from then on; claims already sent keep the rate they were worked out with.
export async function PUT(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const before = await mileageRate();
  if (d.rate_per_km !== undefined) await setSetting('MILEAGE_RATE_PER_KM', String(d.rate_per_km), false, actor.id);
  if (d.maps_api_key !== undefined) { await setSetting('GOOGLE_MAPS_API_KEY', d.maps_api_key, true, actor.id); clearRouteCache(); }
  await logAudit({ actorUserId: actor.id, actionType: 'expense_settings_update', targetType: 'app_settings', metadata: { rate_from: before, rate_to: d.rate_per_km ?? before, key_changed: d.maps_api_key !== undefined } });
  return NextResponse.json({ ok: true });
}
