import { describe, it, expect, afterEach } from 'vitest';
import { fromDirectMessage, safePath } from '@/lib/notifications';
import { ago } from '@/lib/time-ago';

const APP = 'https://mail.example.com';

describe('fromDirectMessage（Mattermost のメッセージを通知の一覧の1件にする）', () => {
  it('1行目がタイトル（太字の印は外す）、リンクは移動先になり、本文には繰り返さない', () => {
    const n = fromDirectMessage(`🧾 **経費申請が届きました**\n\n**山田** さん ・ **¥3,300** ・ 交通費（立替）\n件名: 客先訪問\n\n承認・却下: ${APP}/approvals`, APP);
    expect(n.title).toBe('🧾 経費申請が届きました');
    expect(n.url).toBe('/approvals');
    expect(n.body).toBe('山田 さん ・ ¥3,300 ・ 交通費（立替）\n件名: 客先訪問');
  });
  it('リンクだけの行も移動先になる', () => {
    expect(fromDirectMessage(`📝 **ToDoが割り当てられました**\n\n見積を送る\n\n${APP}/todos`, APP)).toMatchObject({ url: '/todos', body: '見積を送る' });
  });
  it('mmText の逃がし文字（バックスラッシュ・ゼロ幅スペース）を人が読める形に戻す', () => {
    const n = fromDirectMessage('✅ **経費申請が承認されました**\n\n「出張 \\(東京\\) @​taro」 ¥1,000', APP);
    expect(n.body).toBe('「出張 (東京) @taro」 ¥1,000');
  });
  it('リンクがなければ通知の一覧へ。1行だけでも成り立つ', () => {
    expect(fromDirectMessage('🔐 **2段階認証が有効になりました**', APP)).toEqual({ title: '🔐 2段階認証が有効になりました', body: '', url: '/notifications' });
  });
  it('他のサイトへのリンクは移動先にしない', () => {
    expect(fromDirectMessage('お知らせ\nhttps://evil.example.net/phish', APP).url).toBe('/notifications');
  });
  it('長い文は切り詰める', () => {
    const n = fromDirectMessage(`${'あ'.repeat(300)}\n${'い'.repeat(900)}`, APP);
    expect(n.title.length).toBe(120);
    expect(n.body.length).toBe(400);
  });
});

describe('safePath', () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = saved; });
  it('このアプリの中のパスだけを通す', () => {
    expect(safePath('/threads/abc?x=1#top')).toBe('/threads/abc?x=1#top');
    expect(safePath('//evil.example.net/x')).toBe('/notifications');
    expect(safePath('/\\evil.example.net')).toBe('/notifications');
    expect(safePath('javascript:alert(1)')).toBe('/notifications');
    expect(safePath('https://evil.example.net/x')).toBe('/notifications');
    expect(safePath('')).toBe('/notifications');
    expect(safePath(null)).toBe('/notifications');
  });
  it('このアプリの絶対URLはパスにする', () => {
    process.env.NEXT_PUBLIC_APP_URL = APP;
    expect(safePath(`${APP}/todos?a=1`)).toBe('/todos?a=1');
  });
});

describe('ago', () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const at = (sec: number) => new Date(now - sec * 1000).toISOString();
  it('新しいほど細かく、古いと日付', () => {
    expect(ago(at(5), now)).toBe('たった今');
    expect(ago(at(5 * 60), now)).toBe('5分前');
    expect(ago(at(3 * 3600), now)).toBe('3時間前');
    expect(ago(at(2 * 86400), now)).toBe('2日前');
    expect(ago(at(30 * 86400), now)).toMatch(/^\d+\/\d+$/);
  });
  it('未来の時刻（時計のずれ）でも壊れない', () => {
    expect(ago(at(-120), now)).toBe('たった今');
  });
});
