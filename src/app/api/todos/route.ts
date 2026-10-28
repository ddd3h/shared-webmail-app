import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { canEditCalendar, canViewCalendar, listCalendarMembers } from '@/lib/rbac';
import { createSchema, serializeTodo, sortTodos, TEAM } from '@/lib/todo';
import { isValidDateString, toDbDate } from '@/lib/work';
import { notifyTodoAssigned } from '@/lib/work-notify';

const include = { assignee: { select: { name: true } }, done_by: { select: { name: true } }, creator: { select: { name: true } } };

// GET /api/todos?mailboxId=&status=open|done|all&assignee=all|me|team|<userId>&from=&to=
//  from/to (YYYY-MM-DD, both inclusive) keep only to-dos due in that range: this is what the calendar asks for.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const sp = new URL(req.url).searchParams;
  const mailboxId = sp.get('mailboxId') || '';
  const status = sp.get('status') || 'all';
  const assignee = sp.get('assignee') || 'all';
  const from = sp.get('from'), to = sp.get('to');
  if (!mailboxId || !['open', 'done', 'all'].includes(status) || (from && !isValidDateString(from)) || (to && !isValidDateString(to))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  if (!(await canViewCalendar(session.userId, mailboxId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [rows, canEdit, people] = await Promise.all([
    prisma.todos.findMany({
      where: {
        mailbox_id: mailboxId,
        ...(status === 'open' ? { done_at: null } : status === 'done' ? { done_at: { not: null } } : {}),
        ...(assignee === 'all' ? {} : { assignee_id: assignee === TEAM ? null : assignee === 'me' ? session.userId : assignee }),
        ...(from || to ? { due_date: { ...(from ? { gte: toDbDate(from) } : {}), ...(to ? { lte: toDbDate(to) } : {}) } } : {}),
      },
      include,
      take: 500,
    }),
    canEditCalendar(session.userId, mailboxId),
    listCalendarMembers(mailboxId),
  ]);
  return NextResponse.json({ items: sortTodos(rows.map(r => serializeTodo(r))), permissions: { can_edit: canEdit }, people, me: session.userId });
}

// POST /api/todos - add a to-do to the team's list
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { mailboxId, due_date, assignee_id, description, title } = parsed.data;
  if (!(await canEditCalendar(session.userId, mailboxId))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (assignee_id && !(await listCalendarMembers(mailboxId)).some(m => m.id === assignee_id)) {
    return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  }
  const created = await prisma.todos.create({
    data: { mailbox_id: mailboxId, title, description: description || null, due_date: due_date ? toDbDate(due_date) : null, assignee_id: assignee_id || null, created_by_id: session.userId },
  });
  if (created.assignee_id && created.assignee_id !== session.userId) void notifyTodoAssigned(created.id, session.userId);
  return NextResponse.json({ id: created.id }, { status: 201 });
}
