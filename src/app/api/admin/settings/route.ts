import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting } from '@/lib/settings';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const rows = await getAllSettings();
  // mask secrets in response
  const items = rows.map((r) => ({ key: r.key, value: r.is_secret ? '••••••' : r.value, isSecret: r.is_secret }));
  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const body = await req.json().catch(() => ({}));
  // Expect: { updates: [{ key, value, isSecret? }] }
  const updates = Array.isArray(body.updates) ? body.updates : [];
  for (const u of updates) {
    if (!u?.key || typeof u.value !== 'string') continue;
    // Skip masked/placeholder values for secrets — they were never changed in the UI
    if (u.isSecret && (u.value === '••••••' || u.value === '(generated)')) continue;
    await setSetting(u.key, u.value, !!u.isSecret, session!.userId);
  }
  await logAudit({ actorUserId: session!.userId, actionType: 'admin_settings_update', targetType: 'app_settings', metadata: { count: updates.length } });
  return NextResponse.json({ ok: true });
}

