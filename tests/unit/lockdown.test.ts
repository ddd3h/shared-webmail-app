import { describe, it, expect } from 'vitest';
import { FailureMeter, expired, COUNTED_FAILURES } from '@/lib/lockdown';
const lim = () => ({ windowMs: 300_000, fails: 5, ips: 3 });
describe('FailureMeter', () => {
  it('stays quiet under the limits', () => {
    const m = new FailureMeter(lim);
    for (let i = 0; i < 4; i++) expect(m.note('1.1.1.1', 1000 + i)).toBeNull();
  });
  it('many failures from one address do not trip it (needs both limits)', () => {
    const m = new FailureMeter(lim);
    let r = null;
    for (let i = 0; i < 50; i++) r = m.note('1.1.1.1', 1000 + i);
    expect(r).toBeNull();
  });
  it('few failures from many addresses do not trip it', () => {
    const m = new FailureMeter(lim);
    let r = null;
    for (let i = 0; i < 4; i++) r = m.note(`9.9.9.${i}`, 1000 + i);
    expect(r).toBeNull();
  });
  it('trips when both limits are reached', () => {
    const m = new FailureMeter(lim);
    let r = null;
    for (let i = 0; i < 5; i++) r = m.note(`9.9.9.${i % 3}`, 1000 + i);
    expect(r).toMatchObject({ fails: 5, ips: 3 });
  });
  it('forgets failures older than the window', () => {
    const m = new FailureMeter(lim);
    for (let i = 0; i < 4; i++) m.note(`9.9.9.${i}`, 1000 + i);
    expect(m.note('9.9.9.9', 1000 + 300_001 + 5)).toBeNull();
  });
});
describe('lockdown helpers', () => {
  it('expires after the maximum time', () => {
    const at = new Date(0).toISOString();
    expect(expired(JSON.stringify({ at }), 60_000, 120_000)).toBe(false);
    expect(expired(JSON.stringify({ at }), 130_000, 120_000)).toBe(true);
    expect(expired('not json', 1e12, 1)).toBe(false);
  });
  it('counts only failures that reached the password check', () => {
    expect(COUNTED_FAILURES.has('wrong_password')).toBe(true);
    expect(COUNTED_FAILURES.has('rate_limited_account')).toBe(false);
    expect(COUNTED_FAILURES.has('sweep_blocked')).toBe(false);
  });
});
