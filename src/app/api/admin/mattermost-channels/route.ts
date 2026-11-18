import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { channelSchema } from './schema';
import { listPeople } from '@/lib/rbac';

// GET /api/admin/mattermost-channels - the registered channels, with who may use each private one
export async function GET() {
  if (!(await adminActor())) return forbidden();
  const [people, items] = await Promise.all([listPeople(), prisma.mattermost_channels.findMany({
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    include: { users: { select: { user_id: true } } },
  })]);
  return NextResponse.json({ people, items: items.map(c => ({ id: c.id, channel_id: c.channel_id, name: c.name, visibility: c.visibility, sort_order: c.sort_order, user_ids: c.users.map(u => u.user_id) })) });
}

// POST /api/admin/mattermost-channels - register a channel
export async function POST(req: NextRequest) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const parsed = channelSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { user_ids, ...d } = parsed.data;
  if (await prisma.mattermost_channels.findUnique({ where: { channel_id: d.channel_id } })) return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  const users = d.visibility === 'private' && user_ids ? await prisma.users.findMany({ where: { id: { in: user_ids } }, select: { id: true } }) : [];
  const created = await prisma.mattermost_channels.create({
    data: { ...d, users: { create: users.map(u => ({ user_id: u.id })) } },
  });
  await logAudit({ actorUserId: actor.id, actionType: 'mm_channel_add', targetType: 'mattermost_channels', targetId: created.id, metadata: { channel_id: d.channel_id, visibility: d.visibility, users: users.length } });
  return NextResponse.json({ ok: true, id: created.id });
}
