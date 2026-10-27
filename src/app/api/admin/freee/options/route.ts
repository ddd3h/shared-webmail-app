import { NextResponse } from 'next/server';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { listAccountItems, listCompanies, listWalletables, loadFreeeConfig } from '@/lib/freee';

// GET /api/admin/freee/options - what freee offers to choose from: companies, bank accounts and accounts (勘定科目)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const c = await loadFreeeConfig();
  if (!c.connected) return NextResponse.json({ error: 'not_connected' }, { status: 409 });
  const companies = await listCompanies();
  if (!companies.ok) return NextResponse.json({ error: 'freee_error', message: companies.message }, { status: 502 });
  if (!c.companyId) return NextResponse.json({ companies: companies.data.companies.map(x => ({ id: x.id, name: x.display_name || x.name })), walletables: [], account_items: [] });
  const [w, a] = await Promise.all([listWalletables(c.companyId), listAccountItems(c.companyId)]);
  if (!w.ok || !a.ok) return NextResponse.json({ error: 'freee_error', message: (!w.ok ? w : a as { message: string }).message }, { status: 502 });
  return NextResponse.json({
    companies: companies.data.companies.map(x => ({ id: x.id, name: x.display_name || x.name })),
    walletables: w.data.walletables.map(x => ({ id: x.id, name: x.name, type: x.type })),
    account_items: a.data.account_items.map(x => ({ id: x.id, name: x.name })),
  });
}
