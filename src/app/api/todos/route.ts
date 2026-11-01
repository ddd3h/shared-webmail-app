import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { listTeammates, sharesMailbox } from '@/lib/rbac';
import { calendarPeople } from '@/lib/calendar-server';
import { canChangeTodo, createSchema, serializeTodo, sortTodos } from '@/lib/todo';
import { isValidDateString, toDbDate } from '@/lib/work';
import { notifyTodoAssigned } from '@/lib/work-notify';

const include = { assignee: { select: { name: true } }, done_by: { select: { name: true } }, creator: { select: { name: true } } };

// GET /api/todos?status=open|done|all&from=&to=[&mailboxId=&assignee=all|me|<userId>]
//  Without a mailbox: my own list. With a shared mailbox: the lists of the members of that team (assignee narrows it to one of them).
//  from/to (YYYY-MM-DD, both inclusive) keep only to-dos due in that range: this is what the calendar asks for.
export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const sp = new URL(req.url).searchParams;
  const mailboxId = sp.get('mailboxId') || null;
  const status = sp.get('status') || 'all';
  const assignee = sp.get('assignee') || 'all';
  const from = sp.get('from'), to = sp.get('to');
  if (!['open', 'done', 'all'].includes(status) || (from && !isValidDateString(from)) || (to && !isValidDateString(to))) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const people = await calendarPeople(session.userId, mailboxId);
  if (!people) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const who = assignee === 'all' ? people.map(p => p.id) : [assignee === 'me' ? session.userId : assignee];
  if (!who.every(id => people.some(p => p.id === id))) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });

  const [rows, everybody] = await Promise.all([
    prisma.todos.findMany({
      where: {
        assignee_id: { in: who },
        ...(status === 'open' ? { done_at: null } : status === 'done' ? { done_at: { not: null } } : {}),
        ...(from || to ? { due_date: { ...(from ? { gte: toDbDate(from) } : {}), ...(to ? { lte: toDbDate(to) } : {}) } } : {}),
      },
      include,
      take: 500,
    }),
    listTeammates(session.userId),
  ]);
  const items = sortTodos(rows.map(r => ({ ...serializeTodo(r), can_edit: canChangeTodo(session.userId, r) })));
  return NextResponse.json({ items, people, assignable: everybody, me: session.userId });
}

// POST /api/todos - add a to-do to my list (or to the list of somebody I share a team with)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { due_date, assignee_id, description, title } = parsed.data;
  const target = assignee_id || session.userId;
  if (target !== session.userId && !(await sharesMailbox(session.userId, target))) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  if (!(await prisma.users.count({ where: { id: target, locked_at: null } }))) return NextResponse.json({ error: 'invalid_assignee' }, { status: 400 });
  const created = await prisma.todos.create({
    data: { title, description: description || null, due_date: due_date ? toDbDate(due_date) : null, assignee_id: target, created_by_id: session.userId },
  });
  if (target !== session.userId) void notifyTodoAssigned(created.id, session.userId);
  return NextResponse.json({ id: created.id }, { status: 201 });
}
