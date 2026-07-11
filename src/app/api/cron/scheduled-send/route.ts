import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { sendDosAlert } from '@/lib/dos-alert';
import { dispatchDueScheduledSends } from '@/lib/mail/deliver';

const LIMIT = 60;
const WINDOW = 60 * 1000; // 1 minute in MS

// GET /api/cron/scheduled-send - dispatches scheduled emails whose scheduled_at has arrived.
// The app's actual dispatch path is the in-process timer in instrumentation.node.ts
// (same pattern as IMAP sync/MFI jobs); this route exists for external cron / Vercel
// deployments that don't run a persistent Node process.
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = checkRateLimit(`scheduled-send:${ip}`, LIMIT, WINDOW);
  if (!rl.allowed) {
    await sendDosAlert(ip, 'cron-scheduled-send', Math.ceil(rl.retryAfterSec || 0));
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { dispatched, results } = await dispatchDueScheduledSends();
  return NextResponse.json({ ok: true, dispatched, results });
}
