import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendDosAlert } from '@/lib/dos-alert';
import { computeAndStoreMfi } from '@/app/api/mfi/compute';
import { getActiveUsers } from '@/lib/background-jobs';

// 60 calls per minute per IP — prevents sync DoS essentially
const LIMIT = 60;
const WINDOW = 60 * 1000; // 1 minute in MS

// GET /api/cron/sync
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`sync:${ip}`, LIMIT, WINDOW);
  if (!rl.allowed) {
    await sendDosAlert(ip, 'cron-sync', Math.ceil(rl.retryAfterSec || 0));
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    include: { credentials: true }
  });

  const results = [];
  let totalSyncedCount = 0;

  for (const mb of mailboxes) {
    if (!mb.credentials) continue;
    try {
      const syncResult = await syncMailbox(mb.id);
      results.push({ id: mb.id, email: mb.email_address, status: 'ok', synced: syncResult.synced });
      totalSyncedCount += syncResult.synced;
    } catch (e: any) {
      console.error(`[cron] failed sync ${mb.email_address}:`, e?.message || e);
      results.push({ id: mb.id, email: mb.email_address, status: 'error', error: e?.message || String(e) });
    }
  }

  // Compute MFI for all users with mailbox access — personal + team (fire-and-forget)
  const users = await getActiveUsers();
  Promise.allSettled(users.map(u => computeAndStoreMfi(u.id))).catch(() => {});

  return NextResponse.json({ ok: true, mailboxes: results.length, totalSynced: totalSyncedCount, results });
}
