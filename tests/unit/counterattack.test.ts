import { describe, it, expect } from 'vitest';
import { counterattackTargets, isPublicIp, parsePorts } from '@/lib/counterattack';

describe('counterattack helpers', () => {
  it('hits only public addresses', () => {
    expect(isPublicIp('8.8.8.8')).toBe(true);
    expect(isPublicIp('1.1.1.1')).toBe(true);
    expect(isPublicIp('2001:4860:4860::8888')).toBe(true);
    for (const ip of ['10.0.0.1', '172.16.0.1', '192.168.0.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '198.51.100.1', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '2001:db8::1']) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    expect(isPublicIp('not-an-ip')).toBe(false);
  });

  it('cleans and caps the target list', () => {
    expect(counterattackTargets(['8.8.8.8', ' 8.8.8.8 ', '10.0.0.1', 'unknown', '1.1.1.1', null], 10)).toEqual(['8.8.8.8', '1.1.1.1']);
    expect(counterattackTargets(['8.8.8.8', '1.1.1.1', '9.9.9.9'], 2)).toEqual(['8.8.8.8', '1.1.1.1']);
  });

  it('parses ports, dropping bad entries and duplicates', () => {
    expect(parsePorts('80,443, 80, 0, 70000, abc, 22')).toEqual([80, 443, 22]);
  });
});
