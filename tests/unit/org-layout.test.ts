import { describe, it, expect } from 'vitest';
import { autoLayout, positionsFor, NODE_HEIGHT, NODE_WIDTH, COL_GAP, ROW_GAP } from '@/lib/org-layout';

const slot = NODE_WIDTH + COL_GAP;
const row = NODE_HEIGHT + ROW_GAP;
const u = (id: string, parent_id: string | null = null, sort = 0) => ({ id, parent_id, sort, name: id });

describe('組織図の自動配置', () => {
  it('親は子の真ん中の上に。子は横に並ぶ', () => {
    const p = autoLayout([u('root'), u('a', 'root', 1), u('b', 'root', 2)]);
    expect(p.a).toEqual({ x: 0, y: row });
    expect(p.b).toEqual({ x: slot, y: row });
    expect(p.root).toEqual({ x: Math.round(slot / 2), y: 0 });
  });
  it('深さごとに段が下がる。孫のいる枝は、横に場所をとる', () => {
    const p = autoLayout([u('root'), u('a', 'root', 1), u('a1', 'a', 1), u('a2', 'a', 2), u('b', 'root', 2)]);
    expect([p.a1.y, p.a2.y]).toEqual([row * 2, row * 2]);
    expect(p.a1.x).toBe(0);
    expect(p.a2.x).toBe(slot);
    expect(p.b.x).toBe(slot * 2);                         // after the whole 'a' branch
    expect(p.a.x).toBe(Math.round(slot / 2));             // centred over a1 and a2
  });
  it('一番上の部署が複数あれば、横に並ぶ。並びは sort、同じなら名前の順', () => {
    const p = autoLayout([u('z', null, 1), u('b', null, 0), u('a', null, 0)]);
    expect(p.a.x).toBe(0); expect(p.b.x).toBe(slot); expect(p.z.x).toBe(slot * 2);
  });
  it('どの部署も重ならない', () => {
    const units = [u('r'), ...Array.from({ length: 6 }, (_, i) => u(`c${i}`, 'r', i)), ...Array.from({ length: 3 }, (_, i) => u(`g${i}`, 'c2', i))];
    const p = autoLayout(units);
    const pts = Object.values(p);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const overlap = Math.abs(pts[i].x - pts[j].x) < NODE_WIDTH && Math.abs(pts[i].y - pts[j].y) < NODE_HEIGHT;
      expect(overlap).toBe(false);
    }
  });
  it('壊れたデータ（輪・存在しない親）でも、全部の部署に場所がつく', () => {
    const p = autoLayout([u('a', 'b'), u('b', 'a'), u('c', 'nobody'), u('d', 'd')]);
    expect(Object.keys(p).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
  it('保存された場所があればそれを使い、なければ自動の場所', () => {
    const p = positionsFor([{ ...u('root'), pos_x: 500, pos_y: 20 }, { ...u('a', 'root'), pos_x: null, pos_y: null }]);
    expect(p.root).toEqual({ x: 500, y: 20 });
    expect(p.a).toEqual({ x: 0, y: row });
  });
  it('空でも動く', () => { expect(autoLayout([])).toEqual({}); });
});
