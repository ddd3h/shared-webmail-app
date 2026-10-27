import { describe, it, expect } from 'vitest';
import { rankRoutes, type TransitRoute } from '@/lib/transit';
import { parseTransitRoutes } from '@/lib/transit-route';

const ride = (line: string, minutes = 20) => ({ kind: 'transit' as const, minutes, line, from: 'A', to: 'B' });
const walk = (minutes: number) => ({ kind: 'walk' as const, minutes });
const route = (minutes: number, steps: TransitRoute['steps'], fare: number | null): TransitRoute => ({ minutes, transfers: Math.max(0, steps.filter(s => s.kind === 'transit').length - 1), fare_yen: fare, steps, summary: '' });

describe('ルート候補の並べ方と印', () => {
  const a = route(50, [walk(5), ride('X線'), ride('Y線'), walk(5)], 590);
  const b = route(55, [walk(5), ride('Z線'), walk(5)], 590);
  const c = route(67, [walk(15), ride('W線'), ride('Y線'), walk(5)], 480);

  it('短い順に並べ、同じ経路は1つにする', () => {
    const out = rankRoutes([c, a, { ...a }, b]);
    expect(out.map(r => r.minutes)).toEqual([50, 55, 67]);
  });
  it('最短・乗換が少ない・運賃が安い の印は、その点で1つだけ一番の経路に付く。引き分けには付けない', () => {
    const out = rankRoutes([a, b, c]);
    expect(out.map(r => r.tags)).toEqual([['最短'], ['乗換が少ない'], ['運賃が安い']]);   // 徒歩 10 / 10 / 20: a tie at the top, no mark
  });
  it('1つしかなければ印は付けない。運賃が1つしか分からなければ「運賃が安い」は付けない', () => {
    expect(rankRoutes([a])[0].tags).toEqual([]);
    expect(rankRoutes([a, { ...b, fare_yen: null }]).flatMap(r => r.tags ?? [])).not.toContain('運賃が安い');
  });
  it('歩きが1つだけ短ければ「歩きが少ない」が付く。多すぎる候補は4つまで', () => {
    const few = route(60, [walk(1), ride('Q線'), ride('R線'), walk(1)], 700);
    expect(rankRoutes([a, b, few]).find(r => r.minutes === 60)!.tags).toContain('歩きが少ない');
    const many = Array.from({ length: 6 }, (_, i) => route(40 + i, [ride(`L${i}`)], null));
    expect(rankRoutes(many)).toHaveLength(4);
  });
  it('Googleの答えから、全ルートを取り出す', () => {
    const step = (secs: number, line: string) => ({ travelMode: 'TRANSIT', staticDuration: `${secs}s`, transitDetails: { transitLine: { name: line }, stopDetails: { departureStop: { name: 'A' }, arrivalStop: { name: 'B' } } } });
    const json = { routes: [{ duration: '3000s', legs: [{ steps: [step(3000, '遅い線')] }] }, { duration: '1800s', legs: [{ steps: [step(1800, '速い線')] }], travelAdvisory: { transitFare: { currencyCode: 'JPY', units: '300' } } }] };
    const out = parseTransitRoutes(json);
    expect(out.map(r => [r.minutes, r.fare_yen])).toEqual([[30, 300], [50, null]]);
    expect(parseTransitRoutes({})).toEqual([]);
    expect(parseTransitRoutes(null)).toEqual([]);
  });
});
