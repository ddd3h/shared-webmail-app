import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { financeActor, forbidden } from '@/lib/finance-guard';
import { freeeReady, loadFreeeConfig } from '@/lib/freee';
import { collectMovements } from '@/lib/freee-sync';

const day = (d: Date) => d.toISOString().slice(0, 10);

// GET /api/freee/exports - what has been sent to freee, what failed, and what is waiting (経理担当・管理者)
export async function GET() {
  if (!(await financeActor())) return forbidden();
  const c = await loadFreeeConfig();
  const ready = freeeReady(c);
  const [rows, groups] = await Promise.all([
    prisma.freee_exports.findMany({ orderBy: [{ paid_date: 'desc' }, { created_at: 'desc' }], take: 200 }),
    prisma.freee_exports.groupBy({ by: ['status'], _count: { _all: true }, _sum: { amount: true } }),
  ]);
  // paid money that has no row yet (not tried so far): shown as waiting
  let waiting: { source_type: string; source_id: string; date: string; amount: number; description: string }[] = [];
  if (ready) {
    const have = new Set((await prisma.freee_exports.findMany({ select: { source_type: true, source_id: true } })).map(e => `${e.source_type}:${e.source_id}`));
    waiting = (await collectMovements(c.syncFrom!)).filter(m => !have.has(`${m.source_type}:${m.source_id}`)).map(m => ({ source_type: m.source_type, source_id: m.source_id, date: m.date, amount: m.amount, description: m.description }));
  }
  const count = (s: string) => groups.find(g => g.status === s)?._count._all ?? 0;
  return NextResponse.json({
    connected: c.connected, ready, auto_sync: c.autoSync, send_receipts: c.sendReceipts, sync_from: c.syncFrom, company: c.companyName,
    counts: { sent: count('sent'), failed: count('failed'), skipped: count('skipped'), waiting: waiting.length + count('pending') },
    waiting: waiting.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100),
    items: rows.map(r => ({ id: r.id, source_type: r.source_type, source_id: r.source_id, status: r.status, amount: r.amount, paid_date: day(r.paid_date), description: r.description, freee_deal_id: r.freee_deal_id, receipts: Object.keys((r.receipt_map ?? {}) as object).length, error: r.error, attempts: r.attempts, sent_at: r.sent_at })),
  });
}
