import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), requireAuth: vi.fn() }));
vi.mock('@/lib/work-auth', () => ({ getActor: vi.fn() }));
vi.mock('@/lib/org-server', () => ({ hasCapability: vi.fn(), loadOrg: vi.fn() }));

import { missingScores, serializeEvaluation, stageOf, viewerOf, mayView } from '@/lib/eval-server';

const D = (s: string) => new Date(s);
const ev = (o: Record<string, unknown> = {}): any => ({
  id: 'e1', user_id: 'u-subject', evaluator_id: 'u-boss', self_comment: '自分のコメント', manager_comment: '上長のコメント',
  self_submitted_at: D('2026-10-01'), manager_submitted_at: D('2026-10-02'), finalized_at: null, score: null, grade: null, final_comment: null,
  user: { id: 'u-subject', name: '田中' }, evaluator: { id: 'u-boss', name: '佐藤' },
  cycle: { id: 'c1', name: '上期', status: 'open', period_start: D('2026-04-01'), period_end: D('2026-09-30'), criteria: [{ id: 'k1', name: '成果', description: null, weight: 3, sort: 0 }] },
  scores: [{ criterion_id: 'k1', self_score: 4, self_comment: '自', manager_score: 2, manager_comment: '上' }],
  ...o,
});
const as = (id: string, hr = false) => ({ actor: { id } as any, hr });
const view = (e: any, who: ReturnType<typeof as>) => serializeEvaluation(e, viewerOf(who, e));

describe('誰が何を見られるか', () => {
  it('本人は、確定するまで上長の点数・コメント・結果を見られない（自分の欄は見える）', () => {
    const v = view(ev(), as('u-subject'));
    expect(v.criteria[0]).toMatchObject({ self_score: 4, self_comment: '自', manager_score: null, manager_comment: null });
    expect(v).toMatchObject({ self_comment: '自分のコメント', manager_comment: null, manager_submitted_at: null, score: null, grade: null });
  });
  it('確定後は、本人に上長の点数・結果・確定コメントが見える', () => {
    const v = view(ev({ finalized_at: D('2026-10-05'), score: 2, grade: 'C', final_comment: '調整' }), as('u-subject'));
    expect(v.criteria[0].manager_score).toBe(2);
    expect(v).toMatchObject({ grade: 'C', score: 2, final_comment: '調整', stage: 'done' });
  });
  it('評価者は、自己評価が提出されるまで本人の欄を見られない', () => {
    const v = view(ev({ self_submitted_at: null, manager_submitted_at: null }), as('u-boss'));
    expect(v.criteria[0].self_score).toBeNull();
    expect(v.self_comment).toBeNull();
  });
  it('評価者は、提出済みの自己評価と自分の評価が見えるが、確定前の結果は見えない', () => {
    const v = view(ev(), as('u-boss'));
    expect(v.criteria[0]).toMatchObject({ self_score: 4, manager_score: 2 });
    expect(v).toMatchObject({ score: null, grade: null });
  });
  it('人事は、確定前でも全部見える（結果は未確定なので null）', () => {
    const v = view(ev({ score: 2, grade: 'C' }), as('u-hr', true));
    expect(v.criteria[0]).toMatchObject({ self_score: 4, manager_score: 2 });
    expect(v).toMatchObject({ score: 2, grade: 'C' });
  });
  it('関係のない人は見られない', () => {
    expect(mayView(viewerOf(as('u-other'), ev()))).toBe(false);
    expect(mayView(viewerOf(as('u-subject'), ev()))).toBe(true);
    expect(mayView(viewerOf(as('u-boss'), ev()))).toBe(true);
    expect(mayView(viewerOf(as('u-other', true), ev()))).toBe(true);
  });
  it('本人の自己評価の下書き（未提出）は、本人には見える', () => {
    const v = view(ev({ self_submitted_at: null, manager_submitted_at: null }), as('u-subject'));
    expect(v.criteria[0].self_score).toBe(4);
  });
});

describe('進み具合', () => {
  it('自己評価待ち → 上長評価待ち → 確定待ち → 確定済み', () => {
    expect(stageOf({ self_submitted_at: null, manager_submitted_at: null, finalized_at: null })).toBe('self');
    expect(stageOf({ self_submitted_at: D('2026-10-01'), manager_submitted_at: null, finalized_at: null })).toBe('manager');
    expect(stageOf({ self_submitted_at: D('2026-10-01'), manager_submitted_at: D('2026-10-02'), finalized_at: null })).toBe('review');
    expect(stageOf({ self_submitted_at: D('2026-10-01'), manager_submitted_at: D('2026-10-02'), finalized_at: D('2026-10-03') })).toBe('done');
  });
});

describe('提出前のチェック', () => {
  it('全項目に1〜5の点数があれば提出できる', () => {
    expect(missingScores(['a', 'b'], [{ criterion_id: 'a', score: 1, comment: null }, { criterion_id: 'b', score: 5, comment: null }])).toBeNull();
  });
  it('点数がない項目・範囲外があれば理由を返す', () => {
    expect(missingScores(['a', 'b'], [{ criterion_id: 'a', score: 3, comment: null }])).toContain('すべての項目');
    expect(missingScores(['a'], [{ criterion_id: 'a', score: null, comment: null }])).not.toBeNull();
    expect(missingScores(['a'], [{ criterion_id: 'a', score: 6, comment: null }])).not.toBeNull();
  });
});
