import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { saveModel } from '@/lib/spam-classifier';
import { checkAdmin } from '../route';

// PUT /api/admin/spam-classifier/model — upload trained model JSON
export async function PUT(req: NextRequest) {
  const session = await getSession();
  await checkAdmin(session);

  const body = await req.json();
  const { modelData, spamCount, hamCount } = body;

  if (!modelData || typeof modelData !== 'string') {
    return NextResponse.json({ ok: false, error: 'modelData が必要です' }, { status: 400 });
  }

  // Validate it's parseable JSON (basic sanity check)
  try {
    JSON.parse(modelData);
  } catch {
    return NextResponse.json({ ok: false, error: 'modelData が不正なJSONです' }, { status: 400 });
  }

  await saveModel(modelData, Number(spamCount) || 0, Number(hamCount) || 0);
  return NextResponse.json({ ok: true });
}
