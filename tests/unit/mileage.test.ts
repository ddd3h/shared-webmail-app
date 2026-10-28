import { describe, it, expect } from 'vitest';
import { DEFAULT_RATE_PER_KM, mapsLink, metersToKm, mileageAmount, parseRate, roundTripMeters, summarizeMileage } from '@/lib/mileage';

describe('自家用車の計算', () => {
  it('往復は片道の2倍で、100m単位に丸める。金額は km（小数1桁）× 単価', () => {
    expect(roundTripMeters(12340)).toBe(24700);
    expect(metersToKm(24700)).toBe(24.7);
    expect(mileageAmount(24700, 20)).toBe(494);
    expect(summarizeMileage(12340, 20)).toEqual({ one_way_km: 12.3, round_trip_m: 24700, round_trip_km: 24.7, rate_per_km: 20, amount: 494 });
  });
  it('端数は円に丸める', () => {
    expect(mileageAmount(24700, 33)).toBe(815);   // 24.7 x 33 = 815.1
    expect(mileageAmount(100, 25)).toBe(3);       // 0.1 x 25 = 2.5 -> 3
    expect(mileageAmount(0, 20)).toBe(0);
  });
  it('単価の設定: 1〜1000の整数。それ以外・空は既定の20円', () => {
    expect([parseRate('25'), parseRate('1'), parseRate('1000')]).toEqual([25, 1, 1000]);
    expect([parseRate(null), parseRate(''), parseRate('0'), parseRate('1001'), parseRate('2.5'), parseRate('abc')]).toEqual(Array(6).fill(DEFAULT_RATE_PER_KM));
  });
  it('地図のリンクは住所を正しくエンコードする', () => {
    const url = mapsLink('東京都千代田区 1-1', '新宿駅&x=1');
    expect(url).toBe(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('東京都千代田区 1-1')}&destination=${encodeURIComponent('新宿駅&x=1')}&travelmode=driving`);
    expect(new URL(url).searchParams.get('destination')).toBe('新宿駅&x=1');
  });
});
