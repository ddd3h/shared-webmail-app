import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraft } from '@/hooks/useDraft';

type Call = { url: string; method: string; body: any };
let calls: Call[];
let releasePost: (() => void) | null;

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  releasePost = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (method === 'POST') await new Promise<void>(r => { releasePost = r; });
    return { ok: true, status: 200, json: async () => ({ id: 'd1', updated_at: '2026-11-18T00:00:00Z' }) };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useDraft', () => {
  it('作成中に打った新しい内容は捨てず、同じ下書きの更新（PUT）で送る。POSTは1回だけ', async () => {
    const { result } = renderHook(() => useDraft());
    let first!: Promise<string | null>;
    act(() => { first = result.current.saveNow({ subject: 'テスト' }); });
    act(() => { void result.current.saveNow({ subject: 'テストメール' }); });
    await act(async () => { releasePost!(); await first; });
    expect(calls.map(c => c.method)).toEqual(['POST', 'PUT']);
    expect(calls[1].url).toBe('/api/drafts/d1');
    expect(calls[1].body.subject).toBe('テストメール');
  });

  it('入力から1秒以内に画面を閉じても、最後の内容を保存する', async () => {
    const { result, unmount } = renderHook(() => useDraft('d1'));
    act(() => result.current.scheduleSave({ subject: 'あ' }));
    unmount();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/api/drafts/d1' });
  });

  it('送信後の削除は、保存待ち・保存中の内容を捨て、下書きを作り直さない', async () => {
    const { result, unmount } = renderHook(() => useDraft());
    act(() => result.current.scheduleSave({ subject: 'あ' }));
    let del!: Promise<void>;
    act(() => { del = result.current.deleteDraft(); });
    await act(async () => { await del; });
    unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(0);
  });
});
