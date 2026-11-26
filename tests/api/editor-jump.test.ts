import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
  requireAuth: (s: unknown) => { if (!s) throw { status: 401 }; },
}));

import { POST } from '@/app/api/diag/editor-jump/route';
import { getSession } from '@/lib/auth';
import { resetRateLimit } from '@/lib/rate-limit';

const report = () => ({
  v: 1,
  shared: true,
  path: '/threads/cm4abcdefghijklmnopqrstu',
  jump: { from: 48, to: 1, start: 1, size: 60, docChanged: false, metas: ['y-sync$', 'remote'], composing: false, focused: true, tags: ['typing', 'remote'] },
  events: [[-120, 'kd', 'Space', 1, 1, 1], [-80, 'bi', 'insertCompositionText', 3, 1, 1], [-10, 'tr', 'S|y-sync$,remote', 48, 1, 1], [0, 'jump', '', 48, 1, 1], [40, 'kd', 'Enter', 0, 0, 1]],
});
const req = (body: unknown) => ({ text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), headers: new Headers({ 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/131' }) }) as unknown as NextRequest;

let info: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimit('editor-jump:u1');
  (getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: 'u1', role: 'user' });
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => { info.mockRestore(); });

describe('POST /api/diag/editor-jump', () => {
  it('報告をサーバーのログに1行で書く（スレッドの id は落とす）', async () => {
    const res = await POST(req(report()));
    expect(res.status).toBe(200);
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line.startsWith('[editor-jump] ')).toBe(true);
    const logged = JSON.parse(line.slice('[editor-jump] '.length));
    expect(logged).toMatchObject({ user: 'u1', shared: true, path: '/threads/:id', jump: { from: 48, to: 1 } });
    expect(logged.ua).toContain('Macintosh');
    expect(logged.events).toHaveLength(5);
  });

  it('ログインしていなければ通さない', async () => {
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(POST(req(report()))).rejects.toMatchObject({ status: 401 });
    expect(info).not.toHaveBeenCalled();
  });

  it('打った文字が混じった報告は書かない', async () => {
    for (const bad of [[-5, 'kd', 'konnichiha', 0, 0, 1], [-5, 'bi', 'こんにちは', 0, 0, 1], [-5, 'cu', 'abc', 0, 0, 1], [-5, 'tr', 'D|本文', 0, 0, 1]]) {
      const r = report();
      r.events.push(bad as never);
      expect((await POST(req(r))).status).toBe(400);
    }
    // only a note of where it was wrong: never the values
    expect(info).toHaveBeenCalledTimes(4);
    for (const [line] of info.mock.calls) {
      expect(String(line).startsWith('[editor-jump] rejected ')).toBe(true);
      expect(String(line)).not.toMatch(/konnichiha|こんにちは|abc|本文/);
    }
  });

  it('知らない項目・知らない種類・大きすぎる報告は書かない', async () => {
    expect((await POST(req({ ...report(), text: 'お世話になっております' }))).status).toBe(400);
    expect((await POST(req({ ...report(), jump: { ...report().jump, html: '<p>x</p>' } }))).status).toBe(400);
    const r = report();
    r.events.push([0, 'paste', '', 0, 0, 1] as never);
    expect((await POST(req(r))).status).toBe(400);
    expect((await POST(req('not json'))).status).toBe(400);
    expect((await POST(req('x'.repeat(49 * 1024)))).status).toBe(413);
    expect(info.mock.calls.every(([line]: unknown[]) => String(line).startsWith('[editor-jump] rejected '))).toBe(true);
    expect(info.mock.calls.map(([line]: unknown[]) => String(line)).join('\n')).not.toContain('お世話になっております');
  });

  it('1人1時間に30回まで', async () => {
    for (let i = 0; i < 30; i++) expect((await POST(req(report()))).status).toBe(200);
    expect((await POST(req(report()))).status).toBe(429);
    expect(info).toHaveBeenCalledTimes(30);
  });
});
