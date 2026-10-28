// Pure helpers for the shared calendar (no I/O so they are easy to test).

export type DisplayMode = 'busy_only' | 'full';

export type EventRow = {
  id: string;
  source: string;
  title: string | null;
  title_override: string | null;
  description: string | null;
  location: string | null;
  link?: { display_mode: string; busy_label: string } | null;
};

// The title a viewer sees. A team-given name always wins; otherwise events
// imported in busy_only mode show the link's label ("予定あり").
export function displayTitle(e: Pick<EventRow, 'source' | 'title' | 'title_override' | 'link'>): string {
  const override = e.title_override?.trim();
  if (override) return override;
  if (e.source === 'google') {
    if (!e.link || e.link.display_mode !== 'full') return e.link?.busy_label || '予定あり';
    return e.title?.trim() || '(タイトルなし)';
  }
  return e.title?.trim() || '(タイトルなし)';
}

// Details of imported events are only exposed in full mode.
export function canShowDetails(e: Pick<EventRow, 'source' | 'link'>): boolean {
  return e.source !== 'google' || e.link?.display_mode === 'full';
}

export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  transparency?: string;
};

export type ImportedEvent = {
  google_event_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  all_day: boolean;
  start_at: Date;
  end_at: Date;
};

// Convert a Google event into our row. All-day events use UTC midnight dates
// (Google's end date is exclusive, which we keep). In busy_only mode the real
// summary/description/location are dropped here so they are never persisted.
export function toImportedEvent(g: GoogleEvent, mode: DisplayMode): ImportedEvent | null {
  if (!g.id || g.status === 'cancelled') return null;
  const allDay = !!g.start?.date && !g.start?.dateTime;
  const startRaw = g.start?.dateTime ?? g.start?.date;
  const endRaw = g.end?.dateTime ?? g.end?.date ?? startRaw;
  if (!startRaw || !endRaw) return null;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const full = mode === 'full';
  return {
    google_event_id: g.id,
    title: full ? (g.summary ?? null) : null,
    description: full ? (g.description ?? null) : null,
    location: full ? (g.location ?? null) : null,
    all_day: allDay,
    start_at: start,
    end_at: end < start ? start : end,
  };
}
