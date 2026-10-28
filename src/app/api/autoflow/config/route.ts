import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { configSchema } from '@/lib/autoflow/config';
import { loadConfig, saveConfig } from '@/lib/autoflow/run';

// GET /api/autoflow/config - which automatic flows are on, and how many days before they speak (経理・管理者)
export async function GET() {
  if (!(await financeActor())) return forbidden();
  return NextResponse.json({ config: await loadConfig() });
}

// PUT /api/autoflow/config - turn flows on/off and change the days
export async function PUT(req: NextRequest) {
  const actor = await financeActor();
  if (!actor) return forbidden();
  const parsed = configSchema.safeParse((await req.json().catch(() => ({})))?.config);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const before = await loadConfig();
  await saveConfig(parsed.data, actor.id);
  await logAudit({ actorUserId: actor.id, actionType: 'autoflow_config_update', targetType: 'app_settings', targetId: 'AUTOFLOW_CONFIG', metadata: { before, after: parsed.data } });
  return NextResponse.json({ ok: true, config: parsed.data });
}
