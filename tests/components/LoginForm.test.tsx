import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginForm from '@/app/login/LoginForm';

describe('LoginForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初期表示が正しく行われること', () => {
    render(<LoginForm />);
    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument();
  });

  it('正しいクレデンシャルを入力して送信すると、APIが呼ばれること', async () => {
    // 成功するレスポンスをモック
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true })
    });

    render(<LoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('メールアドレス'), 'admin@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'password123');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    // fetchが正しい引数で呼ばれたか確認
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'password123' })
    });
  });

  it('APIエラー(unauthorized)の場合、エラーメッセージが表示されること', async () => {
    // 失敗するレスポンスをモック
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'unauthorized' })
    });

    render(<LoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('メールアドレス'), 'wrong@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    // エラーメッセージが表示されるのを待つ
    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument();
    });
  });

  it('ネットワークエラーの場合、汎用エラーメッセージが表示されること', async () => {
    // ネットワークエラーをモック
    (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

    render(<LoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('メールアドレス'), 'test@example.com');
    await user.type(screen.getByLabelText('パスワード'), 'pass');
    await user.click(screen.getByRole('button', { name: 'ログイン' }));

    await waitFor(() => {
      expect(screen.getByText('ネットワークエラーが発生しました')).toBeInTheDocument();
    });
  });
});
