import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { z } from 'zod';

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  }),
  platform: z.string().optional(),
  userAgent: z.string().optional()
});

// POST /api/push/subscribe - register push subscription
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const body = await req.json().catch(() => ({}));
  const input = schema.parse(body);

  await prisma.push_subscriptions.upsert({
    where: { endpoint: input.endpoint },
    create: {
      user_id: session!.userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      platform: input.platform || 'unknown',
      user_agent: input.userAgent || '',
      is_active: true,
      last_seen_at: new Date()
    },
    update: {
      user_id: session!.userId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      is_active: true,
      last_seen_at: new Date()
    }
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/push/subscribe - unsubscribe
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const { endpoint } = await req.json().catch(() => ({}));
  if (!endpoint) return NextResponse.json({ error: 'missing endpoint' }, { status: 400 });

  await prisma.push_subscriptions.updateMany({
    where: { endpoint, user_id: session!.userId },
    data: { is_active: false }
  });

  return NextResponse.json({ ok: true });
}
