import { NextRequest } from 'next/server';
import { saveForm } from '@/lib/eval-form';

// PUT /api/evaluations/:id/manager - save a draft, or submit with `submit: true` (then it is locked)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return saveForm(req, (await params).id, 'manager');
}
