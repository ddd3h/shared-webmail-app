import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, requireAuth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { JUMP_EVENT_KINDS, JUMP_TAGS, isMetaName, isSafeDetail, pathPattern } from '@/lib/editor-jump';

// POST /api/diag/editor-jump: the editor saw the caret jump to the start of the body while typing (lib/editor-jump-watch.ts).
// The report goes to the server log as one line starting with "[editor-jump]" (pm2's out log). Nothing typed is in it,
// and every detail is checked again here (isSafeDetail), so a bug in the page cannot put text into the log.

const MAX_BYTES = 48 * 1024;
const HOUR = 60 * 60_000;
const PER_HOUR = 30;

const int = z.number().int().min(-10_000_000).max(10_000_000);
const event = z.tuple([int, z.enum(JUMP_EVENT_KINDS), z.string().max(320), int, int, int])
  .refine(([, kind, detail]) => isSafeDetail(kind, detail), { message: 'unsafe detail' });
const schema = z.object({
  v: z.literal(1),
  shared: z.boolean(),
  path: z.string().max(300),
  jump: z.object({
    from: int, to: int, start: int, size: int,
    docChanged: z.boolean(),
    metas: z.array(z.string().refine(isMetaName)).max(20),
    composing: z.boolean(),
    focused: z.boolean(),
    tags: z.array(z.enum(JUMP_TAGS)).max(JUMP_TAGS.length),
  }).strict(),
  events: z.array(event).max(400),
}).strict();

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  if (!checkRateLimit(`editor-jump:${session.userId}`, PER_HOUR, HOUR).allowed) return NextResponse.json({ error: 'too_many' }, { status: 429 });

  const text = await req.text().catch(() => '');
  if (text.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // a refused report still leaves a trace: where it was wrong (the field paths only, never the values)
    console.info(`[editor-jump] rejected ${JSON.stringify({ user: session.userId, issues: parsed.error.issues.slice(0, 10).map(i => i.path.join('.')) })}`);
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const r = parsed.data;
  console.info(`[editor-jump] ${JSON.stringify({
    at: new Date().toISOString(),
    user: session.userId,
    ua: req.headers.get('user-agent')?.slice(0, 200) ?? null,
    shared: r.shared,
    path: pathPattern(r.path),
    jump: r.jump,
    events: r.events,
  })}`);
  return NextResponse.json({ ok: true });
}
