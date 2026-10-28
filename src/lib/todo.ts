// Pure helpers for the shared to-do list (no I/O so they are easy to test).
import { z } from 'zod';
import { isValidDateString, jstDateString } from '@/lib/work';

export const TEAM = 'team'; // the pseudo person "the whole team" in filters (assignee_id is null in the DB)

const dueDate = z.string().refine(isValidDateString, 'invalid_date');

export const createSchema = z.object({
  mailboxId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  due_date: dueDate.nullable().optional(),
  assignee_id: z.string().nullable().optional(),
});

// Every field is optional; `done` flips the finished state on its own.
export const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  due_date: dueDate.nullable().optional(),
  assignee_id: z.string().nullable().optional(),
  done: z.boolean().optional(),
});

/** Overdue = not finished and the due date (Japan-local) is before today. */
export function isOverdue(t: { due_date: string | null; done: boolean }, today: string): boolean {
  return !t.done && !!t.due_date && t.due_date < today;
}

export type TodoRow = {
  id: string; title: string; description: string | null; due_date: Date | null;
  assignee_id: string | null; assignee?: { name: string } | null;
  done_at: Date | null; done_by?: { name: string } | null; creator?: { name: string } | null;
  created_at: Date;
};

export function serializeTodo(t: TodoRow, today = jstDateString(new Date())) {
  const due = t.due_date ? t.due_date.toISOString().slice(0, 10) : null;
  const done = !!t.done_at;
  return {
    id: t.id, title: t.title, description: t.description, due_date: due,
    assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee?.name ?? '' } : null,
    done, done_at: t.done_at, done_by: t.done_by?.name ?? null, created_by: t.creator?.name ?? null,
    overdue: isOverdue({ due_date: due, done }, today),
  };
}
export type TodoItem = ReturnType<typeof serializeTodo>;

/** Open ones first (soonest due date first, no date last), then finished ones (latest first). */
export function sortTodos(items: TodoItem[]): TodoItem[] {
  const key = (t: TodoItem) => t.due_date ?? '9999-12-31';
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return new Date(b.done_at!).getTime() - new Date(a.done_at!).getTime();
    return key(a).localeCompare(key(b));
  });
}
