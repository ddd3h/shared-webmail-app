import { describe, it, expect } from 'vitest';
import { adminNoticeMessage, adminResetMessage, ADMIN_RESET_TTL_MIN } from '@/lib/admin-reset-message';

describe('管理者によるリセットのDM', () => {
  const msg = adminResetMessage('山田 太郎', 'https://mail.example.com/reset-password?token=abc', 60);
  it('宛名と再設定のリンクが入る', () => {
    expect(msg).toContain('山田 太郎 様');
    expect(msg).toContain('(https://mail.example.com/reset-password?token=abc)');
  });
  it('何がリセットされたかと、有効期限（1回だけ）を伝える', () => {
    expect(msg).toContain('パスキーと2段階認証は削除され、パスワードも無効');
    expect(msg).toContain('有効期限: 60分間（1回だけ使えます）');
  });
  it('有効期限は既定で60分', () => {
    expect(ADMIN_RESET_TTL_MIN).toBe(60);
    expect(adminResetMessage('A', 'u')).toContain('60分間');
  });
});

describe('管理者が手で送るお知らせのDM', () => {
  it('見出しを付け、本文の前後の空白は落とす', () => {
    expect(adminNoticeMessage('  パスキーを1つにしてください \n')).toBe('### 📣 管理者からのお知らせ\n\nパスキーを1つにしてください');
  });
});
