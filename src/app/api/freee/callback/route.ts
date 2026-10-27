import { NextRequest, NextResponse, connection } from 'next/server';
import { adminActor } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { connectWithCode, listCompanies } from '@/lib/freee';
import { setSetting } from '@/lib/settings';

// GET /api/freee/callback - where freee sends the browser back after the administrator allowed access
export async function GET(req: NextRequest) {
  await connection(); // answered at request time (it reads the login cookie)
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl}/admin/settings?${q}`);
    res.cookies.delete({ name: 'freee_oauth_state', path: '/api/freee' });
    return res;
  };
  const actor = await adminActor().catch(() => null);
  if (!actor) return NextResponse.redirect(`${appUrl}/login`);

  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  if (!state || state !== req.cookies.get('freee_oauth_state')?.value) return back('freee=invalid_state');
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) return back('freee=denied');

  const r = await connectWithCode(code);
  if (!r.ok) return back('freee=token_failed');
  // the company: the one chosen on freee's screen, or the only one there is; otherwise the administrator chooses in the settings
  const companies = await listCompanies();
  const list = companies.ok ? companies.data.companies : [];
  const chosen = list.find(c => c.id === r.companyId) ?? (list.length === 1 ? list[0] : null);
  if (chosen) { await setSetting('FREEE_COMPANY_ID', String(chosen.id), false, actor.id); await setSetting('FREEE_COMPANY_NAME', chosen.display_name || chosen.name, false, actor.id); }
  await logAudit({ actorUserId: actor.id, actionType: 'freee_connect', targetType: 'app_settings', metadata: { company: chosen?.id ?? null } });
  return back('freee=connected');
}
