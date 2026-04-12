import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { queues } from '@/lib/queue';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const d = await prisma.notification_deliveries.findUnique({ where: { id }, include: { event: true } });
  if (!d || !d.event) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (d.channel === 'webpush') {
    await queues.push.add({ name: 'push', data: { userId: d.event.user_id, title: d.event.title, body: d.event.body, url: d.event.url, priority: d.event.priority.toString() as any } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unsupported_channel' }, { status: 400 });
}

