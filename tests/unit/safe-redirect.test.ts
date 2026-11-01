import { describe, expect, it } from 'vitest';
import { safeFrom } from '@/lib/safe-redirect';

describe('safeFrom（ログイン後に戻る先）', () => {
  it('このアプリの中の画面は、そのまま（クエリも）', () => {
    expect(safeFrom('/threads')).toBe('/threads');
    expect(safeFrom('/calendar?view=week&date=2026-10-26')).toBe('/calendar?view=week&date=2026-10-26');
    expect(safeFrom('/threads/abc#top')).toBe('/threads/abc#top');
  });
  it('指定がない・空なら「/」', () => {
    for (const v of [null, undefined, '', 5 as unknown as string]) expect(safeFrom(v)).toBe('/');
  });
  it('外のサイトへ行く形は、すべて「/」にする', () => {
    for (const evil of ['https://evil.example/x', 'http://evil.example', '//evil.example/x', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'evil.example', '/a\nb', '/a\\b', '///evil.example', 'data:text/html,x'])
      expect(safeFrom(evil), evil).toBe('/');
  });
  it('ログイン画面やAPIには戻らない（ループ・JSON表示になるため）', () => {
    for (const v of ['/login', '/login?from=/x', '/api/todos', '/api']) expect(safeFrom(v), v).toBe('/');
  });
  it('長すぎるものは使わない。フォールバックを変えられる', () => {
    expect(safeFrom('/' + 'a'.repeat(3000))).toBe('/');
    expect(safeFrom('x', '/threads')).toBe('/threads');
  });
});
