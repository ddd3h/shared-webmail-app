// The "who may call this?" check shared by the finance routes: signed in, then the right role.
// Each returns the actor, or null when the role is missing (the route answers with `forbidden()`).
import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
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
export const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 });
