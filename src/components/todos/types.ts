export const TEAM = 'team'; // assignee choice meaning "the whole team"
export type Person = { id: string; name: string };
export type Todo = {
  id: string; title: string; description: string | null; due_date: string | null;
  assignee: { id: string; name: string } | null;
  done: boolean; done_at: string | null; done_by: string | null; created_by: string | null; overdue: boolean;
};

/** Tick or untick a to-do. Resolves to whether it worked. */
export async function setDone(id: string, done: boolean): Promise<boolean> {
  const res = await fetch(`/api/todos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done }) });
  return res.ok;
}

/** What a person may do with a to-do: edit it, or only tick it (when it is theirs). */
export const canTick = (t: Todo, canEdit: boolean, me: string) => canEdit || t.assignee?.id === me;
