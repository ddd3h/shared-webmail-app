import { describe, it, expect } from 'vitest';
import { createSchema, isOverdue, serializeTodo, sortTodos, updateSchema } from '@/lib/todo';

const row = (o: object = {}) => ({ id: 't1', title: 'やること', description: null, due_date: null, assignee_id: null, done_at: null, created_at: new Date(), ...o });

describe('createSchema', () => {
  it('内容の前後の空白は取り除き、空は受け付けない', () => {
    expect(createSchema.parse({ mailboxId: 'm', title: '  見積もり  ' }).title).toBe('見積もり');
    expect(createSchema.safeParse({ mailboxId: 'm', title: '   ' }).success).toBe(false);
    expect(createSchema.safeParse({ mailboxId: 'm', title: 'あ'.repeat(201) }).success).toBe(false);
  });
  it('期限は実在する YYYY-MM-DD だけ（null は期限なし）', () => {
    for (const ok of ['2031-03-10', null, undefined]) expect(createSchema.safeParse({ mailboxId: 'm', title: 'x', due_date: ok }).success).toBe(true);
    for (const bad of ['2031-02-30', '2031-3-1', '来週', '']) expect(createSchema.safeParse({ mailboxId: 'm', title: 'x', due_date: bad }).success).toBe(false);
  });
  it('メールアカウントの指定は必須', () => expect(createSchema.safeParse({ title: 'x' }).success).toBe(false));
});

describe('updateSchema', () => {
  it('どの項目も省略でき、done だけでも通る', () => {
    expect(updateSchema.safeParse({}).success).toBe(true);
    expect(updateSchema.safeParse({ done: true }).success).toBe(true);
    expect(updateSchema.safeParse({ description: null, due_date: null, assignee_id: null }).success).toBe(true);
  });
  it('空の内容・不正な期限は受け付けない', () => {
    expect(updateSchema.safeParse({ title: '' }).success).toBe(false);
    expect(updateSchema.safeParse({ due_date: '2031-13-01' }).success).toBe(false);
  });
});

describe('isOverdue', () => {
  const today = '2031-03-10';
  it('期限が今日より前の未完了だけ期限切れ', () => {
    expect(isOverdue({ due_date: '2031-03-09', done: false }, today)).toBe(true);
    expect(isOverdue({ due_date: '2031-03-10', done: false }, today)).toBe(false);
    expect(isOverdue({ due_date: '2031-03-11', done: false }, today)).toBe(false);
    expect(isOverdue({ due_date: null, done: false }, today)).toBe(false);
    expect(isOverdue({ due_date: '2031-03-09', done: true }, today)).toBe(false);
  });
});

describe('serializeTodo', () => {
  it('期限は日付の文字列、担当・完了者は名前つきで返す', () => {
    const t = serializeTodo(row({ due_date: new Date('2031-03-10T00:00:00Z'), assignee_id: 'u1', assignee: { name: '佐藤' }, done_at: new Date(), done_by: { name: '管理者' } }), '2031-03-11');
    expect(t).toMatchObject({ due_date: '2031-03-10', assignee: { id: 'u1', name: '佐藤' }, done: true, done_by: '管理者', overdue: false });
  });
  it('担当なしはチーム全体（assignee が null）', () => expect(serializeTodo(row()).assignee).toBeNull());
});

describe('sortTodos', () => {
  const t = (title: string, due: string | null, done_at: string | null = null) => serializeTodo(row({ title, due_date: due ? new Date(`${due}T00:00:00Z`) : null, done_at: done_at ? new Date(done_at) : null }), '2031-01-01');
  it('未完了は期限順（期限なしは最後）、完了は新しい順で最後', () => {
    const sorted = sortTodos([t('なし', null), t('完了古', '2031-01-01', '2031-01-02T00:00:00Z'), t('遅い', '2031-05-01'), t('完了新', null, '2031-01-05T00:00:00Z'), t('早い', '2031-02-01')]);
    expect(sorted.map(x => x.title)).toEqual(['早い', '遅い', 'なし', '完了新', '完了古']);
  });
});
