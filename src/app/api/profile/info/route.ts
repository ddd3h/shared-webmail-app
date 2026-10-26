import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { WORKER_TYPE_LABEL, type WorkerType } from '@/lib/work';

// GET /api/profile/info - the person's own details, as the company has them on file (changed by an administrator, not here)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const u = await prisma.users.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true, role: true, worker_type: true, mattermost_user_id: true, org_unit: { select: { name: true } }, position: { select: { name: true } } },
  });
  if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    name: u.name, email: u.email, is_admin: u.role === 'admin',
    worker_type: WORKER_TYPE_LABEL[u.worker_type as WorkerType] ?? u.worker_type,
    unit: u.org_unit?.name ?? null, position: u.position?.name ?? null,
    mattermost_linked: !!u.mattermost_user_id,
  });
}
