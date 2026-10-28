import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  prisma: {
    threads: { findUnique: vi.fn(), update: vi.fn((a: unknown) => ({ op: 'thread.update', a })) },
    mailboxes: { findFirst: vi.fn() },
    messages: { findMany: vi.fn() },
    spam_senders: {
      deleteMany: vi.fn((a: unknown) => ({ op: 'senders.deleteMany', a })),
      upsert: vi.fn((a: unknown) => ({ op: 'senders.upsert', a })),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: vi.fn(),
}));

import { POST as unspam } from '@/app/api/threads/[id]/unspam/route';
import { GET as listSenders } from '@/app/api/admin/spam-senders/route';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';

const db = prisma as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const unspamReq = () => new NextRequest('http://localhost/api/threads/t1/unspam', { method: 'POST' });
const listReq = (qs = '') => new NextRequest(`http://localhost/api/admin/spam-senders${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  (getSession as any).mockResolvedValue({ userId: 'u1', role: 'member' });
  db.threads.findUnique.mockResolvedValue({ id: 't1', mailbox_id: 'm1' });
  db.mailboxes.findFirst.mockResolvedValue({ id: 'm1' });
  db.messages.findMany.mockResolvedValue([{ from_email: 'Alice@Example.com' }, { from_email: 'alice@example.com' }, { from_email: 'bob@example.org' }]);
});

describe('「迷惑メールでない」を押したとき', () => {
  it('スレッドを迷惑メールから外し、ブロックリストから消し、送信者をホワイトリストに入れる', async () => {
    const res = await unspam(unspamReq(), params('t1'));
    expect(res.status).toBe(200);
    expect(db.threads.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { is_spam: false, spam_reason: null, spam_flagged_at: null } });
    expect(db.spam_senders.deleteMany).toHaveBeenCalledWith({ where: { type: 'blocklist', address: { in: ['alice@example.com', 'bob@example.org'] } } });
    expect(db.spam_senders.upsert).toHaveBeenCalledTimes(2);
    expect(db.spam_senders.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { type_address: { type: 'whitelist', address: 'alice@example.com' } },
      create: expect.objectContaining({ type: 'whitelist', address: 'alice@example.com', created_by_id: 'u1' }),
      update: {},
    }));
    expect(await res.json()).toMatchObject({ ok: true, whitelisted: ['alice@example.com', 'bob@example.org'] });
  });

  it('全部ひとつのトランザクションで行う（途中で失敗しても半端に残らない）', async () => {
    await unspam(unspamReq(), params('t1'));
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(4); // thread.update + deleteMany + 2 upserts
  });

  it('届いたメールがない（送信だけの）スレッドでは、ホワイトリストに何も入れない', async () => {
    db.messages.findMany.mockResolvedValue([]);
    const res = await unspam(unspamReq(), params('t1'));
    expect(res.status).toBe(200);
    expect(db.spam_senders.upsert).not.toHaveBeenCalled();
  });

  it('見る権限のないスレッドは403で、何も変えない', async () => {
    db.mailboxes.findFirst.mockResolvedValue(null);
    const res = await unspam(unspamReq(), params('t1'));
    expect(res.status).toBe(403);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('スレッドがなければ404', async () => {
    db.threads.findUnique.mockResolvedValue(null);
    expect((await unspam(unspamReq(), params('nope'))).status).toBe(404);
  });
});

describe('迷惑メールアドレスリストの取得（ページ分け）', () => {
  beforeEach(() => {
    (getSession as any).mockResolvedValue({ userId: 'admin', role: 'admin' });
    db.spam_senders.count.mockResolvedValue(120);
    db.spam_senders.findMany.mockResolvedValue([{ id: 's1', type: 'whitelist', address: 'a@example.com' }]);
  });

  it('管理者以外は403', async () => {
    (getSession as any).mockResolvedValue({ userId: 'u1', role: 'member' });
    expect((await listSenders(listReq('?type=whitelist'))).status).toBe(403);
    expect(db.spam_senders.findMany).not.toHaveBeenCalled();
  });

  it('種類ごとに、指定ページの分だけ読み、全件数とページ数を返す', async () => {
    const res = await listSenders(listReq('?type=whitelist&page=2&pageSize=50'));
    const body = await res.json();
    expect(db.spam_senders.count).toHaveBeenCalledWith({ where: { type: 'whitelist' } });
    expect(db.spam_senders.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'whitelist' }, skip: 50, take: 50, orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }));
    expect(body).toMatchObject({ total: 120, page: 2, pageSize: 50, pages: 3 });
    expect(body.items).toHaveLength(1);
  });

  it('最後のページより先を頼まれたら、最後のページを返す', async () => {
    const body = await (await listSenders(listReq('?type=blocklist&page=99'))).json();
    expect(db.spam_senders.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 100 }));
    expect(body.page).toBe(3);
  });

  it('種類が不正なら400', async () => {
    expect((await listSenders(listReq('?type=other'))).status).toBe(400);
  });
});
