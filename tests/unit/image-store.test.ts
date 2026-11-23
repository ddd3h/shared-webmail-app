import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { image_cache: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() } },
}));

import { prisma } from '@/lib/db';
import { combine, etagOf, matchesEtag, readThrough, secondsLeft, senderKey, type Fetched } from '@/lib/image-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = prisma.image_cache as any;
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const OLD = Buffer.from('GIF89a-old');
const HOUR = 3600 * 1000;
const fresh = { found: 24 * 3600, none: 300 };
const row = (over: Record<string, unknown> = {}) => ({
  key: 'avatar:u1', user_id: 'u1', owner: 'mm1', data: OLD, content_type: 'image/gif', etag: '"old"', source: null, fetched_at: new Date(), ...over,
});

beforeEach(() => {
  table.findUnique.mockReset();
  table.upsert.mockReset().mockResolvedValue({});
});

describe('DBに残す画像（再起動しても残るキャッシュ）', () => {
  it('新しい行があれば、取りに行かずにそれを返す', async () => {
    table.findUnique.mockResolvedValue(row({ fetched_at: new Date(Date.now() - HOUR) }));
    const fetch = vi.fn();
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(Buffer.from(a.image!.base64, 'base64').equals(OLD)).toBe(true);
    expect(a.ttl).toBeGreaterThan(22 * 3600);
  });

  it('古い行は取り直し、取れた画像で置き換える', async () => {
    table.findUnique.mockResolvedValue(row({ fetched_at: new Date(Date.now() - 25 * HOUR) }));
    const a = await readThrough({ key: 'avatar:u1', userId: 'u1', owner: 'mm1', fresh, fetch: async () => ({ kind: 'found', data: PNG, contentType: 'image/png' }) });
    expect(a.image?.contentType).toBe('image/png');
    expect(a.image?.etag).toBe(etagOf(PNG));
    expect(table.upsert.mock.calls[0][0].update).toMatchObject({ owner: 'mm1', user_id: 'u1', content_type: 'image/png', data: PNG });
  });

  it('取り直しに失敗したら、古い画像を出し続け、少しあとにまた試す（DBは書き換えない）', async () => {
    table.findUnique.mockResolvedValue(row({ fetched_at: new Date(Date.now() - 25 * HOUR) }));
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch: async () => ({ kind: 'failed' }) });
    expect(Buffer.from(a.image!.base64, 'base64').equals(OLD)).toBe(true);
    expect(a.ttl).toBe(300);
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it('取りに行く処理が例外を投げても、失敗と同じ扱い', async () => {
    table.findUnique.mockResolvedValue(row({ fetched_at: new Date(Date.now() - 25 * HOUR) }));
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch: async () => { throw new Error('boom'); } });
    expect(a.image).not.toBeNull();
  });

  it('取り直したら「画像なし」だったなら、古い画像は消す', async () => {
    table.findUnique.mockResolvedValue(row({ fetched_at: new Date(Date.now() - 25 * HOUR) }));
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch: async () => ({ kind: 'none' }) });
    expect(a).toEqual({ image: null, ttl: 300 });
    expect(table.upsert.mock.calls[0][0].update).toMatchObject({ data: null, content_type: null });
  });

  it('「画像なし」の行は、その期間のあいだは取りに行かない', async () => {
    table.findUnique.mockResolvedValue(row({ data: null, content_type: null, fetched_at: new Date(Date.now() - 60 * 1000) }));
    const fetch = vi.fn();
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(a.image).toBeNull();
  });

  it('別の持ち主のために取った行は使わない（失敗しても前の人の画像は出さない）', async () => {
    table.findUnique.mockResolvedValue(row({ owner: 'mm-other' }));
    const a = await readThrough({ key: 'avatar:u1', owner: 'mm1', fresh, fetch: async () => ({ kind: 'failed' }) });
    expect(a.image).toBeNull();
  });

  it('画像でないもの、大きすぎるものは残さない', async () => {
    table.findUnique.mockResolvedValue(null);
    const html = await readThrough({ key: 'k', fresh, fetch: async () => ({ kind: 'found', data: Buffer.from('<script>'), contentType: 'text/html' }) });
    expect(html.image).toBeNull();
    const big = await readThrough({ key: 'k', fresh, fetch: async () => ({ kind: 'found', data: Buffer.alloc(1024 * 1024 + 1), contentType: 'image/png' }) });
    expect(big.image).toBeNull();
  });

  it('DBに書けなくても、取れた画像はそのまま返す', async () => {
    table.findUnique.mockResolvedValue(null);
    table.upsert.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = await readThrough({ key: 'k', fresh, fetch: async () => ({ kind: 'found', data: PNG, contentType: 'image/png' }) });
    expect(a.image?.contentType).toBe('image/png');
  });
});

describe('小さな決まり', () => {
  it('送信者アイコンの鍵はハッシュで、アドレスもドメインも平文では残らない', () => {
    const k = senderKey('email', 'someone@example.com');
    expect(k).toMatch(/^sender:[0-9a-f]{64}$/);
    expect(k).not.toContain('example');
    expect(senderKey('domain', 'example.com')).not.toBe(senderKey('email', 'example.com'));
  });

  it('If-None-Match: 一覧・弱いタグ・* も分かる', () => {
    expect(matchesEtag('"a"', '"a"')).toBe(true);
    expect(matchesEtag('"x", W/"a"', '"a"')).toBe(true);
    expect(matchesEtag('*', '"a"')).toBe(true);
    expect(matchesEtag('"b"', '"a"')).toBe(false);
    expect(matchesEtag(null, '"a"')).toBe(false);
  });

  it('新しさの残り秒数', () => {
    const now = Date.now();
    expect(secondsLeft(new Date(now - 10_000), 60, now)).toBe(50);
    expect(secondsLeft(new Date(now - 61_000), 60, now)).toBeLessThanOrEqual(0);
  });

  it('いくつか試したうち: 画像があればそれ、なければ「聞けなかった」が「なし」より優先', () => {
    const found: Fetched = { kind: 'found', data: PNG, contentType: 'image/png' };
    expect(combine([{ kind: 'failed' }, found])).toBe(found);
    expect(combine([{ kind: 'none' }, { kind: 'failed' }])).toEqual({ kind: 'failed' });
    expect(combine([{ kind: 'none' }, { kind: 'none' }])).toEqual({ kind: 'none' });
  });
});
