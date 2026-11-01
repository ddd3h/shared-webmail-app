import { afterEach, describe, expect, it } from 'vitest';
import { cronAuthorized } from '@/lib/cron-auth';

const req = (auth?: string) => ({ headers: { get: (n: string) => (n === 'authorization' ? auth ?? null : null) } });
const SECRET = 'a-long-enough-secret-value';
afterEach(() => { delete process.env.CRON_SECRET; });

describe('cronAuthorized（/api/cron/* を呼べる人）', () => {
  it('秘密が設定されていて、同じ値を持ってきた呼び出しだけ通す', () => {
    process.env.CRON_SECRET = SECRET;
    expect(cronAuthorized(req(`Bearer ${SECRET}`))).toBe(true);
    expect(cronAuthorized(req(`Bearer ${SECRET}x`))).toBe(false);
    expect(cronAuthorized(req('Bearer wrong'))).toBe(false);
    expect(cronAuthorized(req(SECRET))).toBe(false);
    expect(cronAuthorized(req())).toBe(false);
  });
  it('秘密が未設定でも空でも、「Bearer undefined」「Bearer 」では通らない（以前は通った）', () => {
    expect(cronAuthorized(req('Bearer undefined'))).toBe(false);
    process.env.CRON_SECRET = '';
    expect(cronAuthorized(req('Bearer '))).toBe(false);
    expect(cronAuthorized(req(''))).toBe(false);
  });
  it('短すぎる秘密は使わない', () => {
    process.env.CRON_SECRET = 'short';
    expect(cronAuthorized(req('Bearer short'))).toBe(false);
  });
});
