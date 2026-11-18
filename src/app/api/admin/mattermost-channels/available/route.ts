import { NextResponse } from 'next/server';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { mattermostConfig } from '@/lib/mattermost-channels';

// GET /api/admin/mattermost-channels/available - the channels the Bot is in (to pick from when registering)
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const cfg = await mattermostConfig();
  if (!cfg) return NextResponse.json({ error: 'mattermost_not_configured' }, { status: 400 });
  const h = { Authorization: `Bearer ${cfg.botToken}` };
  try {
    const teams = await fetch(`${cfg.baseUrl}/api/v4/users/me/teams`, { headers: h });
    if (!teams.ok) return NextResponse.json({ error: 'mattermost_api_error' }, { status: 502 });
    const out: { channel_id: string; name: string; type: string; team: string }[] = [];
    for (const t of (await teams.json()) as { id: string; display_name: string }[]) {
      const r = await fetch(`${cfg.baseUrl}/api/v4/users/me/teams/${t.id}/channels`, { headers: h });
      if (!r.ok) continue;
      for (const c of (await r.json()) as { id: string; display_name: string; type: string }[]) {
        if (c.type === 'O' || c.type === 'P') out.push({ channel_id: c.id, name: c.display_name, type: c.type === 'P' ? 'private' : 'public', team: t.display_name });
      }
    }
    return NextResponse.json({ items: out });
  } catch {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 });
  }
}
