// The "who may call this?" check shared by the finance routes: signed in, then the right role.
// Each returns the actor, or null when the role is missing (the route answers with `forbidden()`).
import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getActor, isFinance, isYearEndStaff, type Actor } from '@/lib/work-auth';

async function actorWhere(allowed: (a: Actor) => boolean): Promise<Actor | null> {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && allowed(actor) ? actor : null;
}

export const financeActor = () => actorWhere(isFinance);
/** 経理, 人事 or admin: the people who handle 年末調整. */
export const yearEndActor = () => actorWhere(isYearEndStaff);
/** Signed in as a system administrator. The role is the one the database holds (getSession reads it on every request), so a demoted
 *  administrator is refused at once even with an old cookie. Nothing more is read: callers need only the id. */
export async function adminActor(): Promise<{ id: string } | null> {
  const session = await getSession();
  requireAuth(session);
  return session.role === 'admin' ? { id: session.userId } : null;
}
/**
 * Money records about the person themselves (their own pay statement, their own 年末調整, the allowances of their own trip) are not made, changed or
 * confirmed by that same person while somebody else could do it: nobody is both the one who gains and the one who checks. (A company with a single
 * finance person is not locked out.) True = refuse.
 */
export async function selfDealing(actorId: string, subjectUserId: string): Promise<boolean> {
  if (actorId !== subjectUserId) return false;
  return (await prisma.users.count({ where: { id: { not: actorId }, OR: [{ role: 'admin' }, { is_accounting: true }] } })) > 0;
}
export const selfDealingResponse = () => NextResponse.json({ error: 'self_dealing', message: 'ご自身についての金額は、ほかの経理担当・管理者が登録・変更してください' }, { status: 403 });
export const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 });
