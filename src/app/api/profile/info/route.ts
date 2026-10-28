import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { WITHHOLDING_LABEL, WORKER_TYPE_LABEL, paysSalary, toWithholdingClass, type WorkerType } from '@/lib/work';

// GET /api/profile/info - the person's own details, as the company has them on file (changed by an administrator, not here)
export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const u = await prisma.users.findUnique({
    where: { id: session.userId },
    select: { name: true, email: true, role: true, worker_type: true, withholding_class: true, mattermost_user_id: true, org_memberships: { select: { unit: { select: { name: true, sort: true } }, position: { select: { name: true, level: true } } } } },
  });
  if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    name: u.name, email: u.email, is_admin: u.role === 'admin',
    worker_type: WORKER_TYPE_LABEL[u.worker_type as WorkerType] ?? u.worker_type,
    // 源泉徴収の欄: only for people paid a salary (or 役員)
    withholding: paysSalary(u.worker_type as WorkerType) || u.worker_type === 'executive' ? WITHHOLDING_LABEL[toWithholdingClass(u.withholding_class)] : null,
    // every 部署 with the 役職 there (a person may be in several, with a different 役職 in each)
    affiliations: u.org_memberships
      .sort((a, b) => a.unit.sort - b.unit.sort || a.unit.name.localeCompare(b.unit.name))
      .map(m => ({ unit: m.unit.name, position: m.position?.name ?? null })),
    mattermost_linked: !!u.mattermost_user_id,
  });
}
