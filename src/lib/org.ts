// Organisation structure and evaluation maths. Pure functions only (no I/O), so they are easy to test.

// ---- permissions a position can grant ----
export const ORG_CAPABILITIES = {
  approve_requests: { label: '部下の経費・出張を承認する', hint: 'この役職で所属している部署（配下の部署を含む）のメンバーの申請を承認・却下できます' },
  evaluate: { label: '部下の人事評価をする', hint: 'この役職で所属している部署のメンバー（自分より下の役職）の評価者になります' },
  hr_admin: { label: '人事評価を運用する', hint: '評価期間の作成・開始・確定と、全員の結果の閲覧ができます（部署に関係なく全社）' },
} as const;
export type Capability = keyof typeof ORG_CAPABILITIES;
export const CAPABILITY_KEYS = Object.keys(ORG_CAPABILITIES) as Capability[];
export const isCapability = (s: string): s is Capability => s in ORG_CAPABILITIES;

// Roles created by "標準の役職を作成" (a starting point; everything can be edited afterwards)
export const DEFAULT_POSITIONS: { name: string; level: number; permissions: Capability[] }[] = [
  { name: '部長', level: 30, permissions: ['approve_requests', 'evaluate'] },
  { name: '課長', level: 20, permissions: ['approve_requests', 'evaluate'] },
  { name: 'チームリーダー', level: 10, permissions: ['approve_requests', 'evaluate'] },
  { name: 'メンバー', level: 0, permissions: [] },
];

// ---- tree ----
export type Unit = { id: string; parent_id: string | null };
/** One person in one 部署: `level` is the 役職's 序列 there (0 without a 役職), `caps` what that 役職 allows. */
export type Membership = { user_id: string; unit_id: string; level: number; caps: Capability[] };

/** Would making `newParentId` the parent of `unitId` create a loop (or make a unit its own parent)? */
export function wouldCreateCycle(units: Unit[], unitId: string, newParentId: string | null): boolean {
  const parentOf = new Map(units.map(u => [u.id, u.parent_id]));
  for (let cur = newParentId, hops = 0; cur; cur = parentOf.get(cur) ?? null, hops++) {
    if (cur === unitId || hops > units.length) return true;
  }
  return false;
}

/** The given units plus everything below them. */
export function withDescendants(units: Unit[], rootIds: string[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const u of units) if (u.parent_id) childrenOf.set(u.parent_id, [...(childrenOf.get(u.parent_id) ?? []), u.id]);
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return out;
}

/** A unit and the units above it, nearest first. */
export function ancestorsOf(units: Unit[], unitId: string): string[] {
  const byId = new Map(units.map(u => [u.id, u]));
  const out: string[] = [];
  for (let cur = byId.get(unitId), hops = 0; cur && hops <= units.length; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined, hops++) out.push(cur.id);
  return out;
}

/** Where `cap` applies to this person: the 部署 in which their 役職 grants it, and everything below those 部署. */
export function scopeFor(units: Unit[], memberships: Membership[], userId: string, cap: Capability): Set<string> {
  return withDescendants(units, memberships.filter(m => m.user_id === userId && m.caps.includes(cap)).map(m => m.unit_id));
}

/** Everybody who holds `cap` in the 部署 `unitId` or above it (their permission reaches this 部署). */
export function holdersOver(units: Unit[], memberships: Membership[], unitId: string, cap: Capability): string[] {
  const chain = new Set(ancestorsOf(units, unitId));
  return [...new Set(memberships.filter(m => chain.has(m.unit_id) && m.caps.includes(cap)).map(m => m.user_id))];
}

/**
 * Who evaluates `subject` in the 部署 `subject.unit_id`: the person there with the 役職 just above theirs that may evaluate (the lowest 序列
 * above the subject's). Without one, the top evaluator of the 部署 above, and so on up. People for whom `eligible` is false are skipped.
 * Null when nobody qualifies.
 */
export function evaluatorFor(units: Unit[], memberships: Membership[], subject: { id: string; unit_id: string | null; level: number }, eligible: (userId: string) => boolean = () => true): string | null {
  if (!subject.unit_id) return null;
  const pick = (unitId: string, own: boolean): string | null => {
    const found = memberships.filter(m => m.unit_id === unitId && m.user_id !== subject.id && m.caps.includes('evaluate') && eligible(m.user_id) && (!own || m.level > subject.level));
    if (found.length === 0) return null;
    // in their own 部署: the nearest above (lowest 序列); higher up: the top one. Ties are settled by id so the answer never changes between runs.
    found.sort((a, b) => (own ? a.level - b.level : b.level - a.level) || a.user_id.localeCompare(b.user_id));
    return found[0].user_id;
  };
  return ancestorsOf(units, subject.unit_id).reduce<string | null>((got, id, i) => got ?? pick(id, i === 0), null);
}

// ---- evaluation ----
export const MIN_SCORE = 1;
export const MAX_SCORE = 5;
export const isValidScore = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_SCORE && (n as number) <= MAX_SCORE;

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';
export const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D'];
export const GRADE_LABEL: Record<Grade, string> = { S: '期待を大きく上回る', A: '期待を上回る', B: '期待どおり', C: '一部期待に届かない', D: '期待に届かない' };
export const isGrade = (s: string): s is Grade => (GRADES as string[]).includes(s);

/** Weighted average of the manager's scores (1–5). Null until every criterion has a score. */
export function totalScore(criteria: { id: string; weight: number }[], scores: { criterion_id: string; manager_score: number | null }[]): number | null {
  if (criteria.length === 0) return null;
  const byCriterion = new Map(scores.map(s => [s.criterion_id, s.manager_score]));
  let sum = 0; let weights = 0;
  for (const c of criteria) {
    const v = byCriterion.get(c.id);
    if (v === null || v === undefined) return null;
    sum += v * c.weight; weights += c.weight;
  }
  return weights > 0 ? Math.round((sum / weights) * 100) / 100 : null;
}

/** S ≥ 4.5 / A ≥ 3.5 / B ≥ 2.5 / C ≥ 1.5 / D otherwise. */
export function gradeFor(score: number): Grade {
  return score >= 4.5 ? 'S' : score >= 3.5 ? 'A' : score >= 2.5 ? 'B' : score >= 1.5 ? 'C' : 'D';
}
