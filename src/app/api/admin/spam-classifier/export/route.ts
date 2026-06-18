import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getTrainingData } from '@/lib/spam-classifier';
import { checkAdmin } from '../route';

// GET /api/admin/spam-classifier/export — download training data as JSON
export async function GET() {
  const session = await getSession();
  await checkAdmin(session);
  const items = await getTrainingData();
  return NextResponse.json(
    { items, exportedAt: new Date().toISOString() },
    { headers: { 'Content-Disposition': 'attachment; filename="training-data.json"' } }
  );
}
