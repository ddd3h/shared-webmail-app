import { NextRequest, NextResponse } from 'next/server';
import { indexPendingThreads } from '@/lib/semantic-search';
import { embeddingEnabled } from '@/lib/embedding';

// GET /api/cron/embeddings - makes the meaning-vectors of new / changed threads (one batch per call; call again while pending > 0)
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!embeddingEnabled()) return NextResponse.json({ ok: true, enabled: false });
  try {
    const r = await indexPendingThreads(50);
    return NextResponse.json({ ok: true, enabled: true, ...r });
  } catch (e: any) {
    console.error('[cron] embeddings failed:', e?.message || e);
    return NextResponse.json({ ok: false, error: 'embedding_failed' }, { status: 502 });
  }
}
