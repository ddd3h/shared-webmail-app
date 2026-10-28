import type { Grade } from '@/lib/org';

export type Stage = 'self' | 'manager' | 'review' | 'done';
export const STAGE_LABEL: Record<Stage, string> = { self: '自己評価待ち', manager: '上長評価待ち', review: '確定待ち', done: '確定済み' };
export const STAGE_STYLE: Record<Stage, string> = { self: 'bg-amber-100 text-amber-700', manager: 'bg-blue-100 text-blue-700', review: 'bg-violet-100 text-violet-700', done: 'bg-emerald-100 text-emerald-700' };
export const CYCLE_LABEL = { draft: '準備中', open: '評価中', closed: '終了' } as const;

export type Cycle = {
  id: string; name: string; status: 'draft' | 'open' | 'closed'; period_start: string; period_end: string; criteria_count: number;
  progress?: { total: number; self: number; manager: number; finalized: number };
};
export type Criterion = { id: string; name: string; description: string | null; weight: number };
export type Row = {
  id: string; cycle: { id: string; name: string; status: string }; user: { id: string; name: string }; unit?: { id: string; name: string } | null; evaluator: { id: string; name: string } | null;
  stage: Stage; grade: Grade | null; score: number | null;
};
export type Detail = {
  id: string; cycle: { id: string; name: string; status: string; period_start: string; period_end: string };
  user: { id: string; name: string }; unit?: { id: string; name: string } | null; evaluator: { id: string; name: string } | null; stage: Stage;
  self_submitted_at: string | null; manager_submitted_at: string | null; self_comment: string | null; manager_comment: string | null;
  criteria: (Criterion & { self_score: number | null; self_comment: string | null; manager_score: number | null; manager_comment: string | null })[];
  score: number | null; grade: Grade | null; final_comment: string | null; finalized_at: string | null;
  viewer: { isSubject: boolean; isEvaluator: boolean; isHr: boolean };
};
