import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { logAudit } from '@/lib/audit';
import { channelSchema } from '../schema';

// PUT /api/admin/mattermost-channels/:id - change a channel and, for a private one, who may use it
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const { id } = await params;
  const parsed = channelSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const ch = await prisma.mattermost_channels.findUnique({ where: { id } });
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { user_ids, ...d } = parsed.data;
  if (d.channel_id !== ch.channel_id && (await prisma.mattermost_channels.findUnique({ where: { channel_id: d.channel_id } }))) return NextResponse.json({ error: 'duplicate' }, { status: 409 });
  const users = d.visibility === 'private' && user_ids ? await prisma.users.findMany({ where: { id: { in: user_ids } }, select: { id: true } }) : [];
  await prisma.$transaction([
    prisma.mattermost_channels.update({ where: { id }, data: d }),
    prisma.mattermost_channel_users.deleteMany({ where: { channel_ref_id: id } }),
    ...(users.length ? [prisma.mattermost_channel_users.createMany({ data: users.map(u => ({ channel_ref_id: id, user_id: u.id })) })] : []),
  ]);
  await logAudit({ actorUserId: actor.id, actionType: 'mm_channel_update', targetType: 'mattermost_channels', targetId: id, metadata: { visibility: d.visibility, users: users.length } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/mattermost-channels/:id - take a channel off the list (posts already made stay in Mattermost)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await adminActor();
  if (!actor) return forbidden();
  const { id } = await params;
  const ch = await prisma.mattermost_channels.findUnique({ where: { id } });
  if (!ch) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await prisma.mattermost_channels.delete({ where: { id } });
  await logAudit({ actorUserId: actor.id, actionType: 'mm_channel_remove', targetType: 'mattermost_channels', targetId: id, metadata: { channel_id: ch.channel_id } });
  return NextResponse.json({ ok: true });
}
