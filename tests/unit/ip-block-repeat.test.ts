import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    ip_blocks: { findUnique: vi.fn(), upsert: vi.fn() },
    ip_block_history: { upsert: vi.fn() },
  },
}));
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: vi.fn() }));

import { prisma } from '@/lib/db';
import { blockIp } from '@/lib/ip-block';

const auto = (ip = '203.0.113.9') => blockIp({ ip, reason: '自動ブロック: テスト', minutes: 60, source: 'auto' });
const upserted = () => (prisma.ip_blocks.upsert as any).mock.calls[0][0].create;

beforeEach(() => {
  vi.resetAllMocks();
  (prisma.ip_blocks.findUnique as any).mockResolvedValue(null);
});

describe('blockIp: 2回目からは永久', () => {
  it('1回目は、決めた時間だけ', async () => {
    (prisma.ip_block_history.upsert as any).mockResolvedValue({ count: 1 });
    await auto();
    expect(upserted().expires_at).toBeInstanceOf(Date);
    expect(upserted().reason).toBe('自動ブロック: テスト');
  });
  it('2回目は、終わりなし（理由に回数が入る）', async () => {
    (prisma.ip_block_history.upsert as any).mockResolvedValue({ count: 2 });
    await auto();
    expect(upserted().expires_at).toBeNull();
    expect(upserted().reason).toContain('再発のため永久ブロック（2回目）');
  });
  it('今ブロック中の同じ住所は、数え直さない（処理中のリクエストで2回目になってしまわない）', async () => {
    (prisma.ip_blocks.findUnique as any).mockResolvedValue({ ip: 'x', expires_at: new Date(Date.now() + 60_000) });
    expect(await auto()).toBe(true);
    expect(prisma.ip_block_history.upsert).not.toHaveBeenCalled();
    expect(prisma.ip_blocks.upsert).not.toHaveBeenCalled();
  });
  it('ブロックが切れたあとの再発は、2回目として数える', async () => {
    (prisma.ip_blocks.findUnique as any).mockResolvedValue({ ip: 'x', expires_at: new Date(Date.now() - 1000) });
    (prisma.ip_block_history.upsert as any).mockResolvedValue({ count: 2 });
    await auto();
    expect(upserted().expires_at).toBeNull();
  });
  it('管理者の手動ブロックは数えず、この機械自身（ループバック）は自動ブロックしない', async () => {
    await blockIp({ ip: '203.0.113.9', reason: '手動', minutes: 30, source: 'manual' });
    expect(prisma.ip_block_history.upsert).not.toHaveBeenCalled();
    expect(await auto('127.0.0.1')).toBe(false);
  });
});
