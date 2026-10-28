import { describe, it, expect } from 'vitest';
import { activityNote, judgeActivity } from '@/lib/activity-check';

describe('ログインの記録から見る、報告書の怪しさ', () => {
  it('報告する日を含む直近14日の中にログインがあれば、問題なし', () => {
    // 10/10 の報告: 9/27〜10/10 が見る範囲
    expect(judgeActivity('2026-10-10', '2026-10-10', 14).suspicious).toBe(false);
    expect(judgeActivity('2026-10-10', '2026-09-27', 14).suspicious).toBe(false);
  });

  it('範囲の1日前（9/26）が最後のログインなら、怪しい', () => {
    const v = judgeActivity('2026-10-10', '2026-09-26', 14);
    expect(v).toMatchObject({ suspicious: true, days: 14, last_login: '2026-09-26', window_start: '2026-09-27' });
  });

  it('ログインの記録が1回もなければ、怪しい', () => {
    expect(judgeActivity('2026-10-10', null, 14)).toMatchObject({ suspicious: true, last_login: null });
  });

  it('日数の設定を変えると、見る範囲も変わる', () => {
    expect(judgeActivity('2026-10-10', '2026-10-01', 7).suspicious).toBe(true);
    expect(judgeActivity('2026-10-10', '2026-10-01', 14).suspicious).toBe(false);
  });

  it('経理が読む一文に、最後のログインの日が入る', () => {
    expect(activityNote(judgeActivity('2026-10-10', '2026-09-01', 14))).toContain('2026-09-01');
    expect(activityNote(judgeActivity('2026-10-10', null, 14))).toContain('記録がありません');
  });
});
