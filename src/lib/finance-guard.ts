// The "who may call this?" check shared by the finance routes: signed in, then the right role.
// Each returns the actor, or null when the role is missing (the route answers with `forbidden()`).
import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { getActor, isAdmin, isFinance, type Actor } from '@/lib/work-auth';

async function actorWhere(allowed: (a: Actor) => boolean): Promise<Actor | null> {
  const session = await getSession();
  requireAuth(session);
  const actor = await getActor(session.userId);
  return actor && allowed(actor) ? actor : null;
}

export const financeActor = () => actorWhere(isFinance);
export const adminActor = () => actorWhere(isAdmin);
export const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 });
