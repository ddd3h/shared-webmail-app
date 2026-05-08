import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

// 5 calls per minute per IP — prevents sync DoS even when CRON_SECRET is set
const WINDOW_MS = 60 * 1000;
const IP_LIMIT = 5;

// GET /api/cron/sync - sync all active mailboxes
// Protected by CRON_SECRET env variable for security
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const ip = getClientIp(req);
  const result = checkRateLimit(`cron-sync:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!result.allowed) {
    return NextResponse.json(
      { error: 'too_many_requests' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
    );
  }

  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true, email_address: true }
  });

  const results: { mailboxId: string; email: string; synced: number; errors: string[] }[] = [];

  for (const mb of mailboxes) {
    try {
      const r = await syncMailbox(mb.id);
      results.push({ mailboxId: mb.id, email: mb.email_address, ...r });
    } catch (e: any) {
      results.push({ mailboxId: mb.id, email: mb.email_address, synced: 0, errors: [String(e?.message || e)] });
    }
  }

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  return NextResponse.json({ ok: true, mailboxes: results.length, totalSynced, results });
}
