import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { financeActor, forbidden } from '@/lib/finance-guard';

// GET /api/autoflow/notices - the latest automatic messages (who, which flow, delivered to Mattermost or only in the app)
export async function GET() {
  if (!(await financeActor())) return forbidden();
  const rows = await prisma.autoflow_notices.findMany({ orderBy: { created_at: 'desc' }, take: 200 });
  const ids = [...new Set(rows.map(r => r.user_id))];
  const names = new Map((ids.length === 0 ? [] : await prisma.users.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(u => [u.id, u.name]));
  return NextResponse.json({
    items: rows.map(r => ({ id: r.id, rule: r.rule, stage: r.stage, title: r.title, delivered: r.delivered, created_at: r.created_at.toISOString(), user_name: names.get(r.user_id) ?? '(削除されたユーザー)' })),
  });
}
