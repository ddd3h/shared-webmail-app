import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { sharesMailbox } from '@/lib/rbac';
import { canChangeTodo, updateSchema } from '@/lib/todo';
import { toDbDate } from '@/lib/work';
import { notifyTodoAssigned } from '@/lib/work-notify';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/todos/:id - edit it, or tick / untick it. The person whose list it is on, and the person who put it there, may;
// people who only see it through a shared mailbox may not.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const todo = await prisma.todos.findUnique({ where: { id } });
  if (!todo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canChangeTodo(session.userId, todo)) {
    // somebody who shares no team with the person may not even look at it: told it does not exist
    const sees = await sharesMailbox(session.userId, todo.assignee_id);
    return NextResponse.json({ error: sees ? 'forbidden' : 'not_found' }, { status: sees ? 403 : 404 });
  }
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { done, due_date, assignee_id, description, title } = parsed.data;
  if (assignee_id && assignee_id !== todo.assignee_id) {
    if (assignee_id !== session.userId && !(await sharesMailbox(session.userId, assignee_id))) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
    if (!(await prisma.users.count({ where: { id: assignee_id, locked_at: null } }))) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  }

  await prisma.todos.update({
    where: { id },
    data: {
      title,
      description: description === undefined ? undefined : description || null,
      due_date: due_date === undefined ? undefined : due_date ? toDbDate(due_date) : null,
      assignee_id,
      ...(done === undefined || done === !!todo.done_at ? {} : done ? { done_at: new Date(), done_by_id: session.userId } : { done_at: null, done_by_id: null }),
    },
  });
  if (assignee_id && assignee_id !== todo.assignee_id && assignee_id !== session.userId) void notifyTodoAssigned(id, session.userId);
  return NextResponse.json({ ok: true });
}

// DELETE /api/todos/:id - the person whose list it is on, or the person who put it there
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const todo = await prisma.todos.findUnique({ where: { id }, select: { assignee_id: true, created_by_id: true } });
  if (!todo) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!canChangeTodo(session.userId, todo)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.todos.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
