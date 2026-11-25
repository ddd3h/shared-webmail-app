import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SessionGuard from '@/components/SessionGuard';

// パスワードの入れ直しの画面は、ほかの画面（振込の確定など、同じ z-70 の Modal）より上に出す。
// 同じ高さだと、ページの後ろにある画面が上に描かれて、パスワードの画面が隠れ、押した操作が止まったように見える。
const ok = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, clone() { return this; } });
let original: typeof window.fetch;

beforeEach(() => {
  original = window.fetch;
  window.fetch = vi.fn(async () => ok(403, { error: 'recent_login_required' })) as unknown as typeof window.fetch;
});
afterEach(() => { window.fetch = original; });

describe('SessionGuard', () => {
  it('パスワードの確認は、z-70 の画面より上（z-[100]）に出る', async () => {
    render(<SessionGuard />);
    void window.fetch('/api/transfers/batches', { method: 'POST' });
    const dialog = await screen.findByRole('dialog', { name: 'パスワードの確認' });
    expect(dialog.closest('.z-\\[100\\]')).not.toBeNull();
  });
});
