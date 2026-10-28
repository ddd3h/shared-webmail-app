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
    select: { name: true, email: true, role: true, worker_type: true, withholding_class: true, mattermost_user_id: true, org_unit: { select: { name: true } }, extra_units: { select: { unit: { select: { name: true, sort: true } } } }, position: { select: { name: true } } },
  });
  if (!u) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    name: u.name, email: u.email, is_admin: u.role === 'admin',
    worker_type: WORKER_TYPE_LABEL[u.worker_type as WorkerType] ?? u.worker_type,
    // 源泉徴収の欄: only for people paid a salary (or 役員)
    withholding: paysSalary(u.worker_type as WorkerType) || u.worker_type === 'executive' ? WITHHOLDING_LABEL[toWithholdingClass(u.withholding_class)] : null,
    unit: u.org_unit?.name ?? null,
    extra_units: u.extra_units.map(e => e.unit).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map(x => x.name), position: u.position?.name ?? null,
    mattermost_linked: !!u.mattermost_user_id,
  });
}
