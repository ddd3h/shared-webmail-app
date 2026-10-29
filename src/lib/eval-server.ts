// DB side of 人事評価: who may see what, how a form is saved, how a cycle is opened.
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, type Actor } from '@/lib/work-auth';
import { evaluatorFor, isValidScore } from '@/lib/org';
import { designatedUnitsOf, hasCapability, loadOrg } from '@/lib/org-server';

export type EvalContext = { actor: Actor; hr: boolean };

/** The signed-in person and whether they run the evaluations (admin, or 役職 with 人事評価の運用). Null if the user is gone. */
export async function evalContext(): Promise<EvalContext | null> {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor ? { actor, hr: await hasCapability(actor, 'hr_admin') } : null;
}

export const evaluationInclude = {
  cycle: { include: { criteria: { orderBy: { sort: 'asc' as const } } } },
  user: { select: { id: true, name: true } },
  evaluator: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true } },
  scores: true,
};
type Full = NonNullable<Awaited<ReturnType<typeof loadEvaluation>>>;
export const loadEvaluation = (id: string) => prisma.evaluations.findUnique({ where: { id }, include: evaluationInclude });

// ---- who is looking ----
export type Viewer = { isSubject: boolean; isEvaluator: boolean; isHr: boolean };
export const viewerOf = (ctx: EvalContext, ev: { user_id: string; evaluator_id: string | null }): Viewer =>
  ({ isSubject: ev.user_id === ctx.actor.id, isEvaluator: ev.evaluator_id === ctx.actor.id, isHr: ctx.hr });
export const mayView = (v: Viewer) => v.isSubject || v.isEvaluator || v.isHr;

export type Stage = 'self' | 'manager' | 'review' | 'done';
export function stageOf(ev: { self_submitted_at: Date | null; manager_submitted_at: Date | null; finalized_at: Date | null }): Stage {
  if (ev.finalized_at) return 'done';
  if (!ev.self_submitted_at) return 'self';
  return ev.manager_submitted_at ? 'review' : 'manager';
}

/**
 * What this viewer may see. The manager's scores stay hidden from the person being evaluated until the result is final,
 * and the evaluator sees the self-assessment only once it was submitted.
 */
export function serializeEvaluation(ev: Full, v: Viewer) {
  const finalized = !!ev.finalized_at;
  const showSelf = v.isSubject || v.isHr || (v.isEvaluator && !!ev.self_submitted_at);
  const showManager = v.isHr || v.isEvaluator || (v.isSubject && finalized);
  const showResult = finalized ? true : v.isHr;
  const scoreOf = new Map(ev.scores.map(s => [s.criterion_id, s]));
  return {
    id: ev.id,
    cycle: { id: ev.cycle.id, name: ev.cycle.name, status: ev.cycle.status, period_start: ev.cycle.period_start.toISOString().slice(0, 10), period_end: ev.cycle.period_end.toISOString().slice(0, 10) },
    user: ev.user,
    unit: ev.unit,
    evaluator: ev.evaluator,
    stage: stageOf(ev),
    self_submitted_at: showSelf ? ev.self_submitted_at : null,
    manager_submitted_at: showManager ? ev.manager_submitted_at : null,
    self_comment: showSelf ? ev.self_comment : null,
    manager_comment: showManager ? ev.manager_comment : null,
    criteria: ev.cycle.criteria.map(c => {
      const s = scoreOf.get(c.id);
      return {
        id: c.id, name: c.name, description: c.description, weight: c.weight,
        self_score: showSelf ? s?.self_score ?? null : null, self_comment: showSelf ? s?.self_comment ?? null : null,
        manager_score: showManager ? s?.manager_score ?? null : null, manager_comment: showManager ? s?.manager_comment ?? null : null,
      };
    }),
    score: showResult ? ev.score : null,
    grade: showResult ? ev.grade : null,
    final_comment: showResult ? ev.final_comment : null,
    finalized_at: ev.finalized_at,
    viewer: v,
  };
}

// ---- saving a form ----
export type ScoreInput = { criterion_id: string; score: number | null; comment: string | null };
export type Side = 'self' | 'manager';

/** Why a form can't be submitted (a reason for the user), or null when every criterion has a valid score. */
export function missingScores(criteriaIds: string[], inputs: ScoreInput[]): string | null {
  const given = new Map(inputs.map(i => [i.criterion_id, i.score]));
  return criteriaIds.every(id => isValidScore(given.get(id))) ? null : 'すべての項目に1〜5の点数をつけてください';
}

/** Writes one side's scores (a draft, or the final submission). Unknown criteria were rejected earlier. */
export async function saveSide(ev: Full, side: Side, inputs: ScoreInput[], comment: string | null, submit: boolean) {
  await prisma.$transaction(async tx => {
    for (const i of inputs) {
      const data = side === 'self' ? { self_score: i.score, self_comment: i.comment } : { manager_score: i.score, manager_comment: i.comment };
      await tx.eval_scores.upsert({
        where: { evaluation_id_criterion_id: { evaluation_id: ev.id, criterion_id: i.criterion_id } },
        create: { evaluation_id: ev.id, criterion_id: i.criterion_id, ...data }, update: data,
      });
    }
    const stamp = submit ? new Date() : undefined;
    await tx.evaluations.update({
      where: { id: ev.id },
      data: side === 'self' ? { self_comment: comment, ...(stamp ? { self_submitted_at: stamp } : {}) } : { manager_comment: comment, ...(stamp ? { manager_submitted_at: stamp } : {}) },
    });
  });
}

// ---- opening a cycle ----
/** One form per person and per 部署 they belong to (a person in two 部署 gets two forms, each with the evaluator of that 部署). A person in no
 *  部署 gets one form without an evaluator (HR chooses). Returns counts. */
export async function openCycle(cycleId: string): Promise<{ created: number; withoutEvaluator: number }> {
  const [{ units, memberships, capsOf }, users, existing] = await Promise.all([
    loadOrg(),
    prisma.users.findMany({ select: { id: true } }),
    prisma.evaluations.findMany({ where: { cycle_id: cycleId }, select: { user_id: true, unit_id: true } }),
  ]);
  const key = (userId: string, unitId: string | null) => `${userId}|${unitId ?? ''}`;
  const done = new Set(existing.map(e => key(e.user_id, e.unit_id)));
  const eligible = (id: string) => capsOf(id).includes('evaluate');
  const designees = new Map<string, string[]>();
  for (const d of await prisma.org_unit_designations.findMany({ where: { kind: 'evaluation' }, orderBy: [{ created_at: 'asc' }, { user_id: 'asc' }], select: { unit_id: true, user_id: true } })) designees.set(d.unit_id, [...(designees.get(d.unit_id) ?? []), d.user_id]);
  const rows: { cycle_id: string; user_id: string; unit_id: string | null; evaluator_id: string | null }[] = [];
  for (const u of users) {
    const mine = memberships.filter(m => m.user_id === u.id);
    const forms = mine.length ? mine.map(m => ({ unit_id: m.unit_id as string | null, level: m.level })) : [{ unit_id: null, level: 0 }];
    for (const f of forms) {
      if (done.has(key(u.id, f.unit_id))) continue;
      // a 部署 that named its evaluators: the first one named (not the person themselves); otherwise the 役職 rule
      const named = f.unit_id ? (designees.get(f.unit_id) ?? []).find(id => id !== u.id) : undefined;
      rows.push({ cycle_id: cycleId, user_id: u.id, unit_id: f.unit_id, evaluator_id: named ?? evaluatorFor(units, memberships, { id: u.id, unit_id: f.unit_id, level: f.level }, eligible) });
    }
  }
  await prisma.evaluations.createMany({ data: rows });
  return { created: rows.length, withoutEvaluator: rows.filter(r => !r.evaluator_id).length };
}

/** Can this person be the evaluator? (admins, or a 役職 with 部下の人事評価) */
export async function mayEvaluate(userId: string): Promise<boolean> {
  const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  return !!u && ((await hasCapability(u, 'evaluate')) || (await designatedUnitsOf(userId, 'evaluation')).length > 0);
}
