import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { saveModel } from '@/lib/spam-classifier';
import { checkAdmin } from '../route';

// PUT /api/admin/spam-classifier/model — upload trained model JSON
export async function PUT(req: NextRequest) {
  const session = await getSession();
  await checkAdmin(session);

  const modelData = await req.text();

  let model: { spamCount?: number; hamCount?: number; classes?: unknown };
  try {
    model = JSON.parse(modelData);
  } catch {
    return NextResponse.json({ ok: false, error: 'JSONのパースに失敗しました' }, { status: 400 });
  }

  if (!model.classes) {
    return NextResponse.json({ ok: false, error: 'model.json のフォーマットが不正です' }, { status: 400 });
  }

  await saveModel(modelData, Number(model.spamCount) || 0, Number(model.hamCount) || 0);
  return NextResponse.json({ ok: true });
}
