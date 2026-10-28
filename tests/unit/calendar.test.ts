import { describe, it, expect } from 'vitest';
import { displayTitle, canShowDetails, toImportedEvent } from '@/lib/calendar';

const busy = { display_mode: 'busy_only', busy_label: '予定あり' };
const full = { display_mode: 'full', busy_label: '予定あり' };

describe('displayTitle', () => {
  it('ローカル予定はタイトルをそのまま表示する', () => {
    expect(displayTitle({ source: 'local', title: '定例会議', title_override: null })).toBe('定例会議');
  });
  it('「予定ありのみ」のGoogle予定はラベルを表示する', () => {
    expect(displayTitle({ source: 'google', title: null, title_override: null, link: busy })).toBe('予定あり');
  });
  it('ラベルは連携ごとに変更できる', () => {
    expect(displayTitle({ source: 'google', title: null, title_override: null, link: { ...busy, busy_label: '外出中' } })).toBe('外出中');
  });
  it('詳細表示モードではGoogleのタイトルを表示する', () => {
    expect(displayTitle({ source: 'google', title: '商談', title_override: null, link: full })).toBe('商談');
  });
  it('こちら側で付けた名前が最優先される', () => {
    expect(displayTitle({ source: 'google', title: null, title_override: '社内MTG', link: busy })).toBe('社内MTG');
  });
  it('空白だけの名前変更は無視される', () => {
    expect(displayTitle({ source: 'google', title: null, title_override: '  ', link: busy })).toBe('予定あり');
  });
});

describe('canShowDetails', () => {
  it('予定ありのみのGoogle予定は詳細を隠す', () => {
    expect(canShowDetails({ source: 'google', link: busy })).toBe(false);
    expect(canShowDetails({ source: 'google', link: full })).toBe(true);
    expect(canShowDetails({ source: 'local', link: null })).toBe(true);
  });
});

describe('toImportedEvent', () => {
  const g = { id: 'g1', summary: '秘密の面談', description: 'メモ', location: '会議室', start: { dateTime: '2026-10-20T01:00:00Z' }, end: { dateTime: '2026-10-20T02:00:00Z' } };
  it('busy_onlyではタイトル・詳細・場所を保存しない', () => {
    const r = toImportedEvent(g, 'busy_only')!;
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
    expect(r.location).toBeNull();
  });
  it('fullでは保持する', () => {
    expect(toImportedEvent(g, 'full')!.title).toBe('秘密の面談');
  });
  it('終日予定を判定する', () => {
    const r = toImportedEvent({ id: 'g2', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }, 'busy_only')!;
    expect(r.all_day).toBe(true);
  });
  it('キャンセル済みや不正な日付は除外する', () => {
    expect(toImportedEvent({ ...g, status: 'cancelled' }, 'full')).toBeNull();
    expect(toImportedEvent({ id: 'x', start: { dateTime: 'bad' }, end: { dateTime: 'bad' } }, 'full')).toBeNull();
  });
});
