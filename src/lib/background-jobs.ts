import { prisma } from './db';
import { computeAndStoreMfi } from '@/app/api/mfi/compute';

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
