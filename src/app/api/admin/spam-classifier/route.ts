import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { trainModel, getModelStats } from '@/lib/spam-classifier';

async function checkAdmin(session: Awaited<ReturnType<typeof getSession>>) {
  requireAuth(session);
  const actor = await prisma.users.findUnique({ where: { id: session!.userId }, select: { role: true } });
  if (actor?.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403 });
}

export async function GET() {
  const session = await getSession();
  await checkAdmin(session);
  const stats = await getModelStats();
  return NextResponse.json({ stats });
}

export async function POST() {
  const session = await getSession();
  await checkAdmin(session);

  try {
    const result = await trainModel();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : '学習に失敗しました';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
