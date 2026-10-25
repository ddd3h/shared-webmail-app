import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getActor, isAdmin, isFinance } from '@/lib/work-auth';
import { loadZenginSettings, saveZenginSettings, zenginSettingsSchema } from '@/lib/zengin-settings';

// GET /api/zengin/settings - finance staff see whether it is configured; only admins get the values back for editing
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isFinance(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const s = await loadZenginSettings();
  const configured = zenginSettingsSchema.safeParse(s).success;
  return NextResponse.json({ configured, settings: isAdmin(actor) ? s : { client_name: s.client_name, bank_name: s.bank_name, branch_name: s.branch_name } });
}

// PUT /api/zengin/settings - the company's own bank details for the file header (admin only)
export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  if (!actor || !isAdmin(actor)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = zenginSettingsSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', fields: parsed.error.issues.map(i => i.path[0]) }, { status: 400 });
  await saveZenginSettings(parsed.data, actor.id);
  await logAudit({ actorUserId: actor.id, actionType: 'zengin_settings_update', targetType: 'app_settings', metadata: { bank_code: parsed.data.bank_code, branch_code: parsed.data.branch_code } });
  return NextResponse.json({ ok: true });
}
