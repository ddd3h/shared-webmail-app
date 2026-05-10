import { NextRequest, NextResponse } from 'next/server';
import { getAllSettings, setSetting, MANAGED_SETTING_KEYS, SECRET_SETTING_KEYS, type AppSettingKey } from '@/lib/settings';
import { getSession, requireAuth } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { writeEnvValues } from '@/lib/env-file';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const dbRows = await getAllSettings();
  const dbMap = new Map(dbRows.map(r => [r.key, r]));

  const items: { key: string; value: string; isSecret: boolean }[] = MANAGED_SETTING_KEYS.map(key => {
    const row = dbMap.get(key);
    const isSecret = SECRET_SETTING_KEYS.has(key as AppSettingKey) || !!row?.is_secret;
    const value = row?.value || process.env[key] || '';
    return {
      key,
      value: isSecret && value ? '••••••' : value,
      isSecret,
    };
  });

  // Also include any DB rows not in MANAGED_SETTING_KEYS (e.g. legacy entries)
  for (const row of dbRows) {
    if (!(MANAGED_SETTING_KEYS as string[]).includes(row.key)) {
      items.push({ key: row.key, value: row.is_secret ? '••••••' : row.value, isSecret: row.is_secret });
    }
  }

  return NextResponse.json({ items });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];

  const envUpdates: Record<string, string> = {};

  for (const u of updates) {
    if (!u?.key || typeof u.value !== 'string') continue;
    // Skip masked/placeholder values — unchanged secrets
    if (u.isSecret && (u.value === '••••••' || u.value === '(generated)')) continue;
    await setSetting(u.key, u.value, !!u.isSecret, session!.userId);
    envUpdates[u.key] = u.value;
  }

  // Sync to .env file (fire-and-forget style, don't fail the request if this errors)
  if (Object.keys(envUpdates).length > 0) {
    try {
      writeEnvValues(envUpdates);
    } catch (e) {
      console.error('[settings] Failed to write .env:', e);
    }
  }

  await logAudit({ actorUserId: session!.userId, actionType: 'admin_settings_update', targetType: 'app_settings', metadata: { count: updates.length } });
  return NextResponse.json({ ok: true });
}
