import { NextRequest, NextResponse } from 'next/server';
import { recentAuthOrResponse } from '@/lib/reauth';
import { getAllSettings, MANAGED_SETTING_KEYS, SECRET_SETTING_KEYS, type AppSettingKey } from '@/lib/settings';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { writeEnvValues } from '@/lib/env-file';

export async function GET() {
  if (!(await adminActor())) return forbidden();

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
  const actor = await adminActor();
  if (!actor) return forbidden();
  { const stale = await recentAuthOrResponse(); if (stale) return stale; } // high-risk: a recent proof of who is asking (lib/reauth.ts)
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body.updates) ? body.updates : [];

  // Only the settings this screen manages (or ones that are already stored): a key named by the caller is not a way to write ANY value into the server's
  // environment file (NODE_OPTIONS, SESSION_SECRET ... ), and a value cannot carry a line break (it would start a new line of that file).
  const known = new Set<string>([...MANAGED_SETTING_KEYS, ...(await prisma.app_settings.findMany({ select: { key: true } })).map(r => r.key)]);
  const bad = updates.filter((u: { key?: unknown; value?: unknown }) => u && (typeof u.key !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(u.key) || !known.has(u.key) || (typeof u.value === 'string' && (/[\r\n\0]/.test(u.value) || u.value.length > 10_000))));
  if (bad.length > 0) return NextResponse.json({ error: 'invalid_setting', keys: bad.map((u: { key?: unknown }) => String(u.key).slice(0, 64)) }, { status: 400 });

  const envUpdates: Record<string, string> = {};

  // all the changes in one batch (one round trip, all or nothing) instead of one request after another
  const writes: ReturnType<typeof prisma.app_settings.upsert>[] = [];
  for (const u of updates) {
    if (!u?.key || typeof u.value !== 'string') continue;
    // Skip masked/placeholder values — unchanged secrets
    if (u.isSecret && (u.value === '••••••' || u.value === '(generated)')) continue;
    const isSecret = !!u.isSecret;
    writes.push(prisma.app_settings.upsert({
      where: { key: u.key },
      create: { key: u.key, value: u.value, is_secret: isSecret, updated_by: actor.id },
      update: { value: u.value, is_secret: isSecret, updated_by: actor.id },
    }));
    envUpdates[u.key] = u.value;
  }
  if (writes.length > 0) await prisma.$transaction(writes);

  // Sync to .env file (fire-and-forget style, don't fail the request if this errors)
  if (Object.keys(envUpdates).length > 0) {
    try {
      writeEnvValues(envUpdates);
    } catch (e) {
      console.error('[settings] Failed to write .env:', e);
    }
  }

  await logAudit({ actorUserId: actor.id, actionType: 'admin_settings_update', targetType: 'app_settings', metadata: { count: updates.length } });
  return NextResponse.json({ ok: true });
}
