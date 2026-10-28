import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { evalContext, loadEvaluation } from '@/lib/eval-server';
import { finalizeSchema } from '@/lib/eval-input';
import { gradeFor, totalScore } from '@/lib/org';
import { notifyEvaluationFinalized } from '@/lib/work-notify';

const fail = (error: string, status: number, message?: string) => NextResponse.json({ error, message }, { status });

/** Nobody finalizes their own evaluation, as long as somebody else could. */
async function mayFinalize(actorId: string, subjectId: string): Promise<boolean> {
  if (actorId !== subjectId) return true;
  const others = await prisma.users.count({ where: { id: { not: actorId }, OR: [{ role: 'admin' }, { is_hr: true }, { org_memberships: { some: { position: { permissions: { has: 'hr_admin' } } } } }] } });
  return others === 0;
}

// POST /api/evaluations/:id/finalize - fix the result and publish it to the person (HR).
// The grade comes from the evaluator's scores (S ≥ 4.5 / A ≥ 3.5 / B ≥ 2.5 / C ≥ 1.5 / D); HR may set another grade, with a comment saying why.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx?.hr) return fail('forbidden', 403);
  const parsed = finalizeSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail('invalid_body', 400);
  const ev = await loadEvaluation(id);
  if (!ev || ev.cycle.status === 'draft') return fail('not_found', 404);
  if (ev.cycle.status !== 'open') return fail('cycle_not_open', 409);
  if (ev.finalized_at) return fail('finalized', 409);
  if (!ev.manager_submitted_at) return fail('manager_not_submitted', 409, '上長の評価が提出されてから確定できます');
  if (!(await mayFinalize(ctx.actor.id, ev.user_id))) return fail('self_finalize', 403, '自分の評価は、他の人事担当・管理者が確定してください');

  const score = totalScore(ev.cycle.criteria, ev.scores);
  if (score === null) return fail('incomplete', 409);
  const computed = gradeFor(score);
  const grade = parsed.data.grade ?? computed;
  if (grade !== computed && !parsed.data.final_comment) return fail('comment_required', 400, '等級を変更するときは、理由をコメントに書いてください');

  const done = await prisma.evaluations.updateMany({
    where: { id, finalized_at: null },
    data: { score, grade, final_comment: parsed.data.final_comment, finalized_at: new Date(), finalized_by_id: ctx.actor.id },
  });
  if (done.count === 0) return fail('finalized', 409);
  await logAudit({ actorUserId: ctx.actor.id, actionType: 'eval_finalize', targetType: 'evaluations', targetId: id, metadata: { subject: ev.user_id, score, grade, overridden: grade !== computed } });
  void notifyEvaluationFinalized(id);
  return NextResponse.json({ ok: true, score, grade });
}
