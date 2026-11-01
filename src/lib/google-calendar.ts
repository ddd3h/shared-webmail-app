import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { toImportedEvent, type DisplayMode, type GoogleEvent } from '@/lib/calendar';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const STALE_MS = 5 * 60 * 1000;
const PAST_DAYS = 31;
const FUTURE_DAYS = 366;

export function calendarRedirectUri() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${appUrl}/api/calendar/google/callback`;
}

type StoredToken = { access_token: string; refresh_token?: string; expires_at: string };

export async function sealToken(t: StoredToken) {
  return encrypt(JSON.stringify(t));
}

async function getAccessToken(link: { id: string; encrypted_token: string }): Promise<string | null> {
  const t: StoredToken = JSON.parse(await decrypt(link.encrypted_token));
  if (Date.now() < new Date(t.expires_at).getTime() - 60_000) return t.access_token;
  if (!t.refresh_token) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) return null;
  const r = await res.json();
  const next: StoredToken = {
    access_token: r.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (r.expires_in ?? 3600) * 1000).toISOString(),
  };
  await prisma.calendar_google_links.update({ where: { id: link.id }, data: { encrypted_token: await sealToken(next) } });
  return next.access_token;
}

/** Why Google refused to list the calendars, so the screen can say what to fix (an empty list with no reason helps nobody). */
export type GoogleListError = 'api_disabled' | 'insufficient_scope' | 'token_expired' | 'google_api_failed';

/** Google's error answer → what is wrong. `api_disabled`: the Calendar API is not enabled in the Cloud project (the usual cause);
 *  `insufficient_scope`: the person did not tick the calendar permission on the consent screen. */
export function classifyGoogleError(status: number, body: unknown): GoogleListError {
  const e = (body as { error?: { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null)?.error;
  const reasons = [...(e?.errors ?? []).map(x => x.reason), ...(e?.details ?? []).map(x => x.reason)].filter(Boolean).join(' ');
  const text = `${e?.status ?? ''} ${reasons} ${e?.message ?? ''}`;
  if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) return 'api_disabled';
  if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient permission/i.test(text)) return 'insufficient_scope';
  if (status === 401) return 'token_expired';
  return 'google_api_failed';
}

export class GoogleListFailure extends Error {
  constructor(public code: GoogleListError) { super(code); }
}

export async function listGoogleCalendars(link: { id: string; encrypted_token: string }) {
  const token = await getAccessToken(link);
  if (!token) throw new GoogleListFailure('token_expired');
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    console.error('[Google Calendar] calendarList failed:', res.status, JSON.stringify(body)?.slice(0, 500));
    throw new GoogleListFailure(classifyGoogleError(res.status, body));
  }
  const data = await res.json();
  return ((data.items || []) as any[]).map(c => ({
    id: c.id as string,
    name: (c.summaryOverride || c.summary || c.id) as string,
    primary: !!c.primary,
  }));
}

// Pull events of the linked Google calendar into calendar_events.
// Events that vanished from Google inside the window are removed; local
// renames (title_override) of events that still exist are kept.
export async function syncLink(linkId: string): Promise<{ upserted: number; removed: number }> {
  const link = await prisma.calendar_google_links.findUnique({ where: { id: linkId } });
  if (!link || !link.google_calendar_id) return { upserted: 0, removed: 0 };
  try {
    const token = await getAccessToken(link);
    if (!token) throw new Error('Googleとの連携が切れました。再連携してください');

    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86400_000);
    const timeMax = new Date(now + FUTURE_DAYS * 86400_000);
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        ...(pageToken ? { pageToken } : {}),
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(link.google_calendar_id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error(`Google API error (${res.status})`);
      const data = await res.json();
      events.push(...((data.items || []) as GoogleEvent[]));
      pageToken = data.nextPageToken;
    } while (pageToken);

    const mode = link.display_mode as DisplayMode;
    // Free ("transparent") events don't block time; skip them in busy_only mode.
    const rows = events
      .filter(g => mode === 'full' || g.transparency !== 'transparent')
      .map(g => toImportedEvent(g, mode))
      .filter((r): r is NonNullable<typeof r> => !!r);

    let upserted = 0;
    for (const r of rows) {
      await prisma.calendar_events.upsert({
        where: { link_id_google_event_id: { link_id: link.id, google_event_id: r.google_event_id } },
        create: { ...r, source: 'google', link_id: link.id, owner_user_id: link.linked_by_user_id },
        update: { ...r, owner_user_id: link.linked_by_user_id },
      });
      upserted++;
    }
    const keep = rows.map(r => r.google_event_id);
    const removed = await prisma.calendar_events.deleteMany({
      where: {
        link_id: link.id,
        start_at: { gte: timeMin, lte: timeMax },
        google_event_id: { notIn: keep },
      },
    });
    await prisma.calendar_google_links.update({
      where: { id: link.id },
      data: { last_synced_at: new Date(), last_error: null },
    });
    return { upserted, removed: removed.count };
  } catch (e: any) {
    await prisma.calendar_google_links.update({
      where: { id: link.id },
      data: { last_error: String(e?.message || e).slice(0, 500) },
    }).catch(() => {});
    throw e;
  }
}

// Best-effort refresh of the links of these people not synced recently; used when their calendars are opened.
export async function syncStaleLinks(userIds: string[]) {
  const links = await prisma.calendar_google_links.findMany({
    where: {
      linked_by_user_id: { in: userIds },
      google_calendar_id: { not: null },
      OR: [{ last_synced_at: null }, { last_synced_at: { lt: new Date(Date.now() - STALE_MS) } }],
    },
    select: { id: true },
  });
  await Promise.all(links.map(l => syncLink(l.id).catch(() => {})));
}
