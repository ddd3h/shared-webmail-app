import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { setSetting } from '@/lib/settings';
import { logAudit } from '@/lib/audit';
import { getActor, getWorkSettings, isFinance } from '@/lib/work-auth';

export async function GET() {
  const session = await getSession();
  requireAuth(session);
  return NextResponse.json(await getWorkSettings());
}

const schema = z.object({
  daily_minutes: z.number().int().min(0).max(1440),
  auto_break_minutes: z.number().int().min(0).max(240),
});

// PUT /api/work/settings - attendance settings (admin only)
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  await setSetting('WORK_DAILY_MINUTES', String(parsed.data.daily_minutes), false, session.userId);
  await setSetting('WORK_AUTO_BREAK_MINUTES', String(parsed.data.auto_break_minutes), false, session.userId);
  await logAudit({ actorUserId: session.userId, actionType: 'work_settings_update', targetType: 'app_settings', metadata: parsed.data });
  return NextResponse.json({ ok: true });
}
