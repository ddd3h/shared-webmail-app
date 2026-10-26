import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canEditCalendar, canViewCalendar, listCalendarMembers } from '@/lib/rbac';
import { updateSchema } from '@/lib/todo';
import { toDbDate } from '@/lib/work';
import { notifyTodoAssigned } from '@/lib/work-notify';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/todos/:id - edit it, or tick / untick it.
// Editing needs the calendar's edit permission; ticking is also open to the person it is assigned to.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const todo = await prisma.todos.findUnique({ where: { id } });
  if (!todo || !(await canViewCalendar(session.userId, todo.mailbox_id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const parsed = updateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { done, due_date, assignee_id, description, title } = parsed.data;

  const onlyTicking = Object.keys(parsed.data).every(k => k === 'done');
  const allowed = (await canEditCalendar(session.userId, todo.mailbox_id)) || (onlyTicking && todo.assignee_id === session.userId);
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (assignee_id && !(await listCalendarMembers(todo.mailbox_id)).some(m => m.id === assignee_id)) {
    return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  }

  await prisma.todos.update({
    where: { id },
    data: {
      title,
      description: description === undefined ? undefined : description || null,
      due_date: due_date === undefined ? undefined : due_date ? toDbDate(due_date) : null,
      assignee_id: assignee_id === undefined ? undefined : assignee_id || null,
      ...(done === undefined || done === !!todo.done_at ? {} : done ? { done_at: new Date(), done_by_id: session.userId } : { done_at: null, done_by_id: null }),
    },
  });
  if (assignee_id && assignee_id !== todo.assignee_id && assignee_id !== session.userId) void notifyTodoAssigned(id, session.userId);
  return NextResponse.json({ ok: true });
}

// DELETE /api/todos/:id
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  const todo = await prisma.todos.findUnique({ where: { id }, select: { mailbox_id: true } });
  if (!todo || !(await canViewCalendar(session.userId, todo.mailbox_id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canEditCalendar(session.userId, todo.mailbox_id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await prisma.todos.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
