import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { adminActor, forbidden } from '@/lib/finance-guard';
import { queues } from '@/lib/queue';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await adminActor())) return forbidden();
  const { id } = await params;
  const d = await prisma.notification_deliveries.findUnique({ where: { id }, include: { event: true } });
  if (!d || !d.event) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (d.channel === 'webpush') {
    await queues.push.add({ name: 'push', data: { userId: d.event.user_id, title: d.event.title, body: d.event.body, url: d.event.url, priority: d.event.priority.toString() as any } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'unsupported_channel' }, { status: 400 });
}

