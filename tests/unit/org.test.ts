import { describe, it, expect } from 'vitest';
import { ancestorsOf, evaluatorFor, gradeFor, holdersOver, isValidScore, scopeFor, totalScore, wouldCreateCycle, withDescendants, type Capability, type Membership, type Unit } from '@/lib/org';

//  root ── sales ── sales-a
//       └─ dev
const units: Unit[] = [
  { id: 'root', parent_id: null },
  { id: 'sales', parent_id: 'root' },
  { id: 'sales-a', parent_id: 'sales' },
  { id: 'dev', parent_id: 'root' },
];
const BOSS: Capability[] = ['approve_requests', 'evaluate'];
// 営業部: 佐藤 = 課長(20), 鈴木 = 班長(10), 田中 = メンバー(0)。開発部: 山田 = 部長(30)、田中は開発部では班長(10)。本社: 社長(40)
const m = (user_id: string, unit_id: string, level: number, caps: Capability[] = level >= 10 ? BOSS : []): Membership => ({ user_id, unit_id, level, caps });
const memberships: Membership[] = [
  m('ceo', 'root', 40), m('sato', 'sales', 20), m('suzuki', 'sales', 10), m('tanaka', 'sales', 0),
  m('yamada', 'dev', 30), m('tanaka', 'dev', 10),
];

describe('ツリー', () => {
  it('配下の部署をすべて数える（自分を含む）', () => {
    expect([...withDescendants(units, ['sales'])].sort()).toEqual(['sales', 'sales-a']);
    expect([...withDescendants(units, ['root'])].sort()).toEqual(['dev', 'root', 'sales', 'sales-a']);
    expect(withDescendants(units, []).size).toBe(0);
  });
  it('部署と、その上の部署を近い順に', () => {
    expect(ancestorsOf(units, 'sales-a')).toEqual(['sales-a', 'sales', 'root']);
    expect(ancestorsOf(units, 'root')).toEqual(['root']);
    expect(ancestorsOf(units, 'none')).toEqual([]);
  });
  it('親にすると輪になる移動を検出する', () => {
    expect(wouldCreateCycle(units, 'sales', 'sales-a')).toBe(true); // under its own child
    expect(wouldCreateCycle(units, 'sales', 'sales')).toBe(true);
    expect(wouldCreateCycle(units, 'sales', 'dev')).toBe(false);
    expect(wouldCreateCycle(units, 'sales', null)).toBe(false);
  });
  it('すでに壊れた（輪のある）データでも無限ループしない', () => {
    const broken: Unit[] = [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }];
    expect(wouldCreateCycle(broken, 'c', 'a')).toBe(true);
    expect(evaluatorFor(broken, [m('boss', 'a', 20)], { id: 'x', unit_id: 'a', level: 0 })).toBe('boss');
    expect(ancestorsOf(broken, 'a').length).toBeLessThanOrEqual(3);
  });
});

describe('権限の及ぶ範囲（役職は、その人が所属している部署ごとに効く）', () => {
  it('承認できる役職で所属している部署と、その配下', () => {
    expect([...scopeFor(units, memberships, 'sato', 'approve_requests')].sort()).toEqual(['sales', 'sales-a']);
    expect(scopeFor(units, memberships, 'ceo', 'approve_requests').size).toBe(4);
  });
  it('メンバー（権限のない役職）や、所属のない人には範囲がない', () => {
    expect(scopeFor(units, memberships, 'nobody', 'approve_requests').size).toBe(0);
    expect([...scopeFor(units, memberships, 'tanaka', 'approve_requests')]).toEqual(['dev']);   // 営業部ではメンバー（権限なし）、開発部では班長
  });
  it('部署ごとに違う役職: 営業部ではメンバー、開発部では班長（田中）', () => {
    expect(scopeFor(units, memberships, 'tanaka', 'evaluate').has('sales')).toBe(false);
    expect(scopeFor(units, memberships, 'tanaka', 'evaluate').has('dev')).toBe(true);
  });
  it('部署と、その上の部署で、権限を持つ人を全員', () => {
    expect(holdersOver(units, memberships, 'sales', 'approve_requests').sort()).toEqual(['ceo', 'sato', 'suzuki']);
    expect(holdersOver(units, memberships, 'dev', 'approve_requests').sort()).toEqual(['ceo', 'tanaka', 'yamada']);
    expect(holdersOver(units, memberships, 'sales-a', 'evaluate').sort()).toEqual(['ceo', 'sato', 'suzuki']);
  });
});

describe('評価者の決め方（所属ごとに1人）', () => {
  it('自分の部署で、一つ上の役職の人（一番近い上）', () => {
    expect(evaluatorFor(units, memberships, { id: 'tanaka', unit_id: 'sales', level: 0 })).toBe('suzuki'); // メンバー(0) の上で一番近いのは班長(10)
    expect(evaluatorFor(units, memberships, { id: 'suzuki', unit_id: 'sales', level: 10 })).toBe('sato');
  });
  it('部署が2つなら、それぞれの部署の評価者（田中: 営業部では班長の鈴木、開発部では部長の山田）', () => {
    expect(evaluatorFor(units, memberships, { id: 'tanaka', unit_id: 'sales', level: 0 })).toBe('suzuki');
    expect(evaluatorFor(units, memberships, { id: 'tanaka', unit_id: 'dev', level: 10 })).toBe('yamada');
  });
  it('部署に上の役職の人がいなければ、上の部署のいちばん上の人', () => {
    expect(evaluatorFor(units, memberships, { id: 'sato', unit_id: 'sales', level: 20 })).toBe('ceo');
    expect(evaluatorFor(units, memberships, { id: 'x', unit_id: 'sales-a', level: 0 })).toBe('sato');
  });
  it('一番上の人は評価者なし。所属がなければ評価者なし', () => {
    expect(evaluatorFor(units, memberships, { id: 'ceo', unit_id: 'root', level: 40 })).toBeNull();
    expect(evaluatorFor(units, memberships, { id: 'x', unit_id: null, level: 0 })).toBeNull();
  });
  it('評価の権限がない人は飛ばす。同じ役職の人は上に数えない', () => {
    expect(evaluatorFor(units, memberships, { id: 'tanaka', unit_id: 'sales', level: 0 }, id => id !== 'suzuki')).toBe('sato');
    expect(evaluatorFor(units, memberships, { id: 'tanaka', unit_id: 'sales', level: 0 }, () => false)).toBeNull();
    const peers = [m('a', 'dev', 20), m('b', 'dev', 20)];
    expect(evaluatorFor(units, peers, { id: 'a', unit_id: 'dev', level: 20 })).toBeNull();
  });
  it('同じ序列の候補が2人いるときは、いつも同じ人（idの順）', () => {
    const two = [m('b-boss', 'dev', 20), m('a-boss', 'dev', 20)];
    expect(evaluatorFor(units, two, { id: 'x', unit_id: 'dev', level: 0 })).toBe('a-boss');
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
