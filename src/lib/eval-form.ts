// Saving or submitting one side of an evaluation form (the person's own, or the evaluator's).
import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { evalContext, loadEvaluation, missingScores, saveSide, viewerOf, type ScoreInput, type Side } from '@/lib/eval-server';
import { formSchema } from '@/lib/eval-input';
import { notifyEvaluationManagerSubmitted, notifyEvaluationSelfSubmitted } from '@/lib/work-notify';

const fail = (error: string, status: number, message?: string) => NextResponse.json({ error, message }, { status });

/** The scores as they would be after this save: what is stored, overwritten by what was sent. */
function mergedScores(stored: { criterion_id: string; self_score: number | null; manager_score: number | null }[], sent: ScoreInput[], side: Side): ScoreInput[] {
  const byId = new Map<string, ScoreInput>(stored.map(s => [s.criterion_id, { criterion_id: s.criterion_id, score: side === 'self' ? s.self_score : s.manager_score, comment: null }]));
  for (const s of sent) byId.set(s.criterion_id, s);
  return [...byId.values()];
}

export async function saveForm(req: NextRequest, id: string, side: Side) {
  const ctx = await evalContext();
  if (!ctx) return fail('not_found', 404);
  const ev = await loadEvaluation(id);
  if (!ev || ev.cycle.status === 'draft') return fail('not_found', 404);

  const v = viewerOf(ctx, ev);
  if (side === 'self' ? !v.isSubject : !v.isEvaluator) return fail('forbidden', 403);
  if (ev.cycle.status !== 'open') return fail('cycle_not_open', 409);
  if (ev.finalized_at) return fail('finalized', 409);
  if (side === 'self' ? ev.self_submitted_at : ev.manager_submitted_at) return fail('already_submitted', 409);
  if (side === 'manager' && !ev.self_submitted_at) return fail('self_not_submitted', 409, '本人の自己評価が提出されてから評価できます');

  const parsed = formSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail('invalid_body', 400);
  const { scores, comment, submit } = parsed.data;
  const known = new Set(ev.cycle.criteria.map(c => c.id));
  if (scores.some(s => !known.has(s.criterion_id))) return fail('unknown_criterion', 400);
  if (submit) {
    const problem = missingScores([...known], mergedScores(ev.scores, scores, side));
    if (problem) return fail('incomplete', 400, problem);
  }

  await saveSide(ev, side, scores, comment, submit);
  if (submit) {
    await logAudit({ actorUserId: ctx.actor.id, actionType: `eval_${side}_submit`, targetType: 'evaluations', targetId: id, metadata: { subject: ev.user_id } });
    void (side === 'self' ? notifyEvaluationSelfSubmitted(id) : notifyEvaluationManagerSubmitted(id));
  }
  return NextResponse.json({ ok: true, submitted: submit });
}
