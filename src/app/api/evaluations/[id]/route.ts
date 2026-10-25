import { NextRequest, NextResponse } from 'next/server';
import { evalContext, loadEvaluation, mayView, serializeEvaluation, viewerOf } from '@/lib/eval-server';

// GET /api/evaluations/:id - one form, with only the parts the caller may see (the subject, their evaluator, or HR)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await evalContext();
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const ev = await loadEvaluation(id);
  if (!ev || ev.cycle.status === 'draft') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const v = viewerOf(ctx, ev);
  if (!mayView(v)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json(serializeEvaluation(ev, v));
}
