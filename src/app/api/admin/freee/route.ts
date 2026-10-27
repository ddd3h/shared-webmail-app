import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { encrypt } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { setSetting } from '@/lib/settings';
import { accountMapSchema, disconnectFreee, freeeReady, freeeRedirectUri, listCompanies, listWalletables, loadFreeeConfig, MAP_KINDS } from '@/lib/freee';
import { EXPENSE_CATEGORIES } from '@/lib/expense';

// GET /api/admin/freee - the connection and what the money is booked as (system administrators only; secrets are never sent back)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const c = await loadFreeeConfig();
  return NextResponse.json({
    client_id: c.clientId, has_secret: c.hasSecret, connected: c.connected, ready: freeeReady(c),
    company: c.companyId ? { id: c.companyId, name: c.companyName } : null, walletable: c.walletable,
    account_map: c.map, auto_sync: c.autoSync, sync_from: c.syncFrom, redirect_uri: freeeRedirectUri(),
    kinds: MAP_KINDS, expense_categories: EXPENSE_CATEGORIES,
  });
}

const schema = z.object({
  client_id: z.string().trim().max(200).optional(),
  client_secret: z.string().trim().max(300).optional(),   // empty = keep
  company_id: z.number().int().positive().optional(),
  walletable: z.object({ id: z.number().int().positive(), type: z.enum(['bank_account', 'credit_card', 'wallet']), name: z.string().max(200).optional() }).nullable().optional(),
  account_map: accountMapSchema.optional(),
  auto_sync: z.boolean().optional(),
  sync_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// PUT /api/admin/freee
export async function PUT(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const d = parsed.data;
  const before = await loadFreeeConfig();

  if (d.client_id !== undefined) await setSetting('FREEE_CLIENT_ID', d.client_id, false, actor.id);
  if (d.client_secret) await setSetting('FREEE_CLIENT_SECRET', await encrypt(d.client_secret), true, actor.id);
  if (d.company_id !== undefined && d.company_id !== before.companyId) {
    // the company must be one this connection can see; a different company means the old bank account and accounts no longer apply
    const list = await listCompanies();
    const found = list.ok ? list.data.companies.find(c => c.id === d.company_id) : null;
    if (!found) return NextResponse.json({ error: 'company_not_found' }, { status: 400 });
    await setSetting('FREEE_COMPANY_ID', String(found.id), false, actor.id);
    await setSetting('FREEE_COMPANY_NAME', found.display_name || found.name, false, actor.id);
    await prisma.app_settings.deleteMany({ where: { key: { in: ['FREEE_WALLETABLE', 'FREEE_ACCOUNT_MAP'] } } });
  }
  if (d.walletable !== undefined) {
    if (d.walletable === null) await prisma.app_settings.deleteMany({ where: { key: 'FREEE_WALLETABLE' } });
    else {
      const cid = (await loadFreeeConfig()).companyId;
      const list = cid ? await listWalletables(cid) : null;
      if (!list?.ok || !list.data.walletables.some(w => w.id === d.walletable!.id)) return NextResponse.json({ error: 'walletable_not_found' }, { status: 400 });
      await setSetting('FREEE_WALLETABLE', JSON.stringify({ id: d.walletable.id, type: d.walletable.type, name: d.walletable.name }), false, actor.id);
    }
  }
  if (d.account_map !== undefined) await setSetting('FREEE_ACCOUNT_MAP', JSON.stringify(d.account_map), false, actor.id);
  if (d.sync_from !== undefined) await setSetting('FREEE_SYNC_FROM', d.sync_from, false, actor.id);
  if (d.auto_sync !== undefined) {
    if (d.auto_sync && !freeeReady(await loadFreeeConfig())) return NextResponse.json({ error: 'not_ready' }, { status: 409 }); // turn it on only when it can work
    await setSetting('FREEE_AUTO_SYNC', d.auto_sync ? 'on' : 'off', false, actor.id);
  }
  await logAudit({ actorUserId: actor.id, actionType: 'freee_settings_update', targetType: 'app_settings', metadata: { fields: Object.keys(d).filter(k => k !== 'client_secret'), secret_changed: !!d.client_secret } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/freee - disconnect: the tokens, company, bank account and automatic sending are removed (what was already sent stays in freee)
export async function DELETE() {
  const actor = await adminActor();
  if (!actor) return forbidden();
  await disconnectFreee();
  await logAudit({ actorUserId: actor.id, actionType: 'freee_disconnect', targetType: 'app_settings' });
  return NextResponse.json({ ok: true });
}
