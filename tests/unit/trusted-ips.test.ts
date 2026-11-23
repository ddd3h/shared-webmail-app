import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SECURITY_CACHE_TTL_MS = '0'; // read the (mocked) settings and blocks every time

vi.mock('@/lib/db', () => ({
  prisma: {
    ip_blocks: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
    ip_block_history: { upsert: vi.fn() },
  },
}));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }));
vi.mock('@/lib/security-events', () => ({ recordSecurityEvent: vi.fn() }));

import { prisma } from '@/lib/db';
import { getSetting } from '@/lib/settings';
import { recordSecurityEvent } from '@/lib/security-events';
import { blockIp, isIpBlocked } from '@/lib/ip-block';
import { isTrustedIp } from '@/lib/security-settings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const OURS = '219.104.167.157';
const OTHER = '198.51.100.20';

beforeEach(() => {
  vi.mocked(getSetting).mockReset().mockImplementation(async (key: string) => (key === 'SECURITY_TRUSTED_CIDRS' ? `${OURS}  # 本社\n203.0.113.0/24` : null));
  db.ip_blocks.findMany.mockReset().mockResolvedValue([]);
  db.ip_blocks.findUnique.mockReset().mockResolvedValue(null);
  db.ip_blocks.upsert.mockReset().mockResolvedValue({});
  db.ip_block_history.upsert.mockReset().mockResolvedValue({ count: 1 });
  vi.mocked(recordSecurityEvent).mockReset();
});

describe('信頼するアドレス（ホワイトリスト）', () => {
  it('一覧のアドレスと範囲は信頼し、それ以外・不明は信頼しない', async () => {
    expect(await isTrustedIp(OURS)).toBe(true);
    expect(await isTrustedIp('203.0.113.77')).toBe(true);
    expect(await isTrustedIp(OTHER)).toBe(false);
    expect(await isTrustedIp('unknown')).toBe(false);
  });

  it('自動ブロックはしない（記録だけ残す）', async () => {
    expect(await blockIp({ ip: OURS, reason: '自動ブロック: ロボットの接続（スクリプト・自動ツール）', minutes: 60, source: 'auto' })).toBe(false);
    expect(db.ip_blocks.upsert).not.toHaveBeenCalled();
    expect(db.ip_block_history.upsert).not.toHaveBeenCalled(); // not counted toward a permanent block either
    expect(vi.mocked(recordSecurityEvent).mock.calls[0][0]).toMatchObject({ type: 'trusted_ip_not_blocked', ip: OURS });
  });

  it('一覧にないアドレスは、これまでどおり自動ブロックする', async () => {
    expect(await blockIp({ ip: OTHER, reason: '自動ブロック: x', minutes: 60, source: 'auto' })).toBe(true);
    expect(db.ip_blocks.upsert).toHaveBeenCalled();
  });

  it('管理者が手で入れるブロックは、信頼するアドレスにも効く', async () => {
    expect(await blockIp({ ip: OURS, reason: '手動', minutes: null, source: 'manual' })).toBe(true);
    expect(db.ip_blocks.upsert).toHaveBeenCalled();
  });

  it('すでにある自動ブロックは、信頼するアドレスには効かない（手動のブロックは効く）', async () => {
    db.ip_blocks.findMany.mockResolvedValue([{ ip: OURS, source: 'auto' }, { ip: OTHER, source: 'auto' }]);
    expect(await isIpBlocked(OURS)).toBe(false);
    expect(await isIpBlocked(OTHER)).toBe(true);
    db.ip_blocks.findMany.mockResolvedValue([{ ip: OURS, source: 'manual' }]);
    expect(await isIpBlocked(OURS)).toBe(true);
  });

  it('一覧が空なら、何も変わらない', async () => {
    vi.mocked(getSetting).mockResolvedValue(null);
    db.ip_blocks.findMany.mockResolvedValue([{ ip: OURS, source: 'auto' }]);
    expect(await isIpBlocked(OURS)).toBe(true);
  });
});
