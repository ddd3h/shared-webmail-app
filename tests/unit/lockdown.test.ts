import { describe, it, expect } from 'vitest';
import { FailureMeter } from '@/lib/lockdown';
const lim = () => ({ windowMs: 300_000, fails: 5, ips: 3 });
describe('FailureMeter', () => {
  it('stays quiet under the limits', () => {
    const m = new FailureMeter(lim);
    for (let i = 0; i < 4; i++) expect(m.note('1.1.1.1', 1000 + i)).toBeNull();
  });
  it('trips on the number of failures', () => {
    const m = new FailureMeter(lim);
    let r = null;
    for (let i = 0; i < 5; i++) r = m.note('1.1.1.1', 1000 + i);
    expect(r).toMatchObject({ fails: 5, ips: 1 });
  });
  it('trips on the number of different addresses', () => {
    const m = new FailureMeter(lim);
    m.note('1.1.1.1', 1); m.note('2.2.2.2', 2);
    expect(m.note('3.3.3.3', 3)).toMatchObject({ ips: 3 });
  });
  it('forgets failures older than the window', () => {
    const m = new FailureMeter(lim);
    for (let i = 0; i < 4; i++) m.note('1.1.1.1', 1000 + i);
    expect(m.note('1.1.1.1', 1000 + 300_001 + 5)).toBeNull();
  });
});
