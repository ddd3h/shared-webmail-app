import { describe, it, expect } from 'vitest';
import { evaluatorFor, gradeFor, isValidScore, scopeOf, totalScore, wouldCreateCycle, withDescendants, type Unit } from '@/lib/org';

//  root(head: ceo) ── sales(head: sato) ── sales-a(head: none)
//                  └─ dev(head: dev-head)
const units: Unit[] = [
  { id: 'root', parent_id: null, head_user_id: 'ceo' },
  { id: 'sales', parent_id: 'root', head_user_id: 'sato' },
  { id: 'sales-a', parent_id: 'sales', head_user_id: null },
  { id: 'dev', parent_id: 'root', head_user_id: 'dev-head' },
];

describe('ツリー', () => {
  it('配下の部署をすべて数える（自分を含む）', () => {
    expect([...withDescendants(units, ['sales'])].sort()).toEqual(['sales', 'sales-a']);
    expect([...withDescendants(units, ['root'])].sort()).toEqual(['dev', 'root', 'sales', 'sales-a']);
    expect(withDescendants(units, []).size).toBe(0);
  });
  it('権限の及ぶ範囲＝自分が部署長の部署と、その配下', () => {
    expect([...scopeOf(units, 'sato')].sort()).toEqual(['sales', 'sales-a']);
    expect(scopeOf(units, 'nobody').size).toBe(0);
    expect(scopeOf(units, 'ceo').size).toBe(4);
  });
  it('親にすると輪になる移動を検出する', () => {
    expect(wouldCreateCycle(units, 'sales', 'sales-a')).toBe(true); // under its own child
    expect(wouldCreateCycle(units, 'sales', 'sales')).toBe(true);
    expect(wouldCreateCycle(units, 'sales', 'dev')).toBe(false);
    expect(wouldCreateCycle(units, 'sales', null)).toBe(false);
  });
  it('すでに壊れた（輪のある）データでも無限ループしない', () => {
    const broken: Unit[] = [{ id: 'a', parent_id: 'b', head_user_id: null }, { id: 'b', parent_id: 'a', head_user_id: null }];
    expect(wouldCreateCycle(broken, 'c', 'a')).toBe(true);
    expect(evaluatorFor(broken, { id: 'x', unit_id: 'a' })).toBeNull();
  });
});

describe('評価者の決め方', () => {
  it('自分の部署の部署長', () => expect(evaluatorFor(units, { id: 'tanaka', unit_id: 'sales' })).toBe('sato'));
  it('部署長がいない部署なら、上の部署の部署長', () => expect(evaluatorFor(units, { id: 'tanaka', unit_id: 'sales-a' })).toBe('sato'));
  it('自分が部署長なら、さらに上の部署の部署長', () => expect(evaluatorFor(units, { id: 'sato', unit_id: 'sales' })).toBe('ceo'));
  it('一番上の部署長は評価者なし', () => expect(evaluatorFor(units, { id: 'ceo', unit_id: 'root' })).toBeNull());
  it('所属がなければ評価者なし', () => expect(evaluatorFor(units, { id: 'x', unit_id: null })).toBeNull());
  it('評価の権限がない部署長は飛ばして、その上へ', () => {
    expect(evaluatorFor(units, { id: 'tanaka', unit_id: 'sales' }, id => id !== 'sato')).toBe('ceo');
    expect(evaluatorFor(units, { id: 'tanaka', unit_id: 'sales' }, () => false)).toBeNull();
  });
});

describe('総合点と等級', () => {
  const criteria = [{ id: 'a', weight: 2 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }];
  it('重みつきの平均（小数2桁）', () => {
    expect(totalScore(criteria, [{ criterion_id: 'a', manager_score: 5 }, { criterion_id: 'b', manager_score: 3 }, { criterion_id: 'c', manager_score: 2 }])).toBe(3.75);
  });
  it('全部そろっていなければ null', () => {
    expect(totalScore(criteria, [{ criterion_id: 'a', manager_score: 5 }, { criterion_id: 'b', manager_score: null }, { criterion_id: 'c', manager_score: 2 }])).toBeNull();
    expect(totalScore(criteria, [])).toBeNull();
    expect(totalScore([], [])).toBeNull();
  });
  it('重みが全部同じなら単純平均', () => {
    expect(totalScore([{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }], [{ criterion_id: 'a', manager_score: 4 }, { criterion_id: 'b', manager_score: 3 }])).toBe(3.5);
  });
  const cases: [number, string][] = [[5, 'S'], [4.5, 'S'], [4.49, 'A'], [3.5, 'A'], [3.49, 'B'], [2.5, 'B'], [2.49, 'C'], [1.5, 'C'], [1.49, 'D'], [1, 'D']];
  for (const [score, grade] of cases) it(`${score} → ${grade}`, () => expect(gradeFor(score)).toBe(grade));
  it('点数は1〜5の整数だけ', () => {
    for (const ok of [1, 2, 3, 4, 5]) expect(isValidScore(ok)).toBe(true);
    for (const bad of [0, 6, 2.5, -1, '3', null, undefined, NaN]) expect(isValidScore(bad)).toBe(false);
  });
});
