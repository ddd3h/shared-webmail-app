import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logAudit } from '@/lib/audit';
import { isValidRule, ipMatches } from '@/lib/cidr';
import { getClientIp } from '@/lib/rate-limit';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { blockIp } from '@/lib/ip-block';

const schema = z.object({ ip: z.string().trim().min(1).max(50), reason: z.string().trim().min(1).max(200), minutes: z.number().int().min(1).max(60 * 24 * 365).nullable().default(null) });

// POST /api/admin/security/blocks - block an address (or an IPv4 range) by hand
export async function POST(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !isValidRule(parsed.data.ip)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  // never cut off the admin who is doing it
  if (ipMatches(getClientIp(req), parsed.data.ip)) return NextResponse.json({ error: 'blocks_yourself', message: '今アクセスしているあなた自身のアドレスはブロックできません' }, { status: 409 });
  await blockIp({ ...parsed.data, source: 'manual', byUserId: actor.id });
  await logAudit({ actorUserId: actor.id, actionType: 'ip_block', targetType: 'ip_blocks', metadata: parsed.data });
  return NextResponse.json({ ok: true }, { status: 201 });
}
