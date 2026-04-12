import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { syncMailbox } from '@/lib/mail/sync';

// GET /api/cron/sync - sync all active mailboxes
// Protected by CRON_SECRET env variable for security
// Can be called by Vercel Cron, external cron, or periodic polling
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const mailboxes = await prisma.mailboxes.findMany({
    where: { is_active: true },
    select: { id: true, email_address: true }
  });

  const results: { mailboxId: string; email: string; synced: number; errors: string[] }[] = [];

  for (const mb of mailboxes) {
    try {
      const result = await syncMailbox(mb.id);
      results.push({ mailboxId: mb.id, email: mb.email_address, ...result });
    } catch (e: any) {
      results.push({ mailboxId: mb.id, email: mb.email_address, synced: 0, errors: [String(e?.message || e)] });
    }
  }

  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  return NextResponse.json({ ok: true, mailboxes: results.length, totalSynced, results });
}
