import { prisma } from './db';
import { computeMfi, computeAndStoreMfi } from '@/app/api/mfi/compute';
import { MFI_ALERT_THRESHOLD } from './mfi';
import { sendMfiBelowThresholdDm } from './mattermost-dm';

export async function getActiveUsers() {
  const users = await prisma.users.findMany({
    select: { id: true, email: true }
  });
  return users;
}

// Compute MFI for every user. Snapshot writes are rate-limited to one per
// 4 hours inside computeAndStoreMfi (shouldCreateSnapshot), so this is safe
// to call on a much shorter interval.
export async function computeMfiForAllUsers() {
  const users = await getActiveUsers().catch(() => [] as { id: string; email: string }[]);
  const results = await Promise.allSettled(users.map(u => computeAndStoreMfi(u.id)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[mfi] snapshot failed for ${users[i].email}:`, r.reason?.message || r.reason);
    }
  });
}

// MFI low-score DM alerts. Called once per weekday at noon (scheduled in
// instrumentation.node.ts) — uses a fresh MFI computation, not the last
// snapshot, so the judgement reflects the state at 12:00.
export async function runMfiNoonAlerts() {
  const users = await getActiveUsers().catch(() => [] as { id: string; email: string }[]);
  for (const u of users) {
    try {
      const data = await computeMfi(u.id);
      if (data.mfi < MFI_ALERT_THRESHOLD) {
        await sendMfiBelowThresholdDm(u.id, u.email, data.mfi);
      }
    } catch (e: any) {
      console.error(`[mfi] noon alert failed for ${u.email}:`, e?.message || e);
    }
  }
}
