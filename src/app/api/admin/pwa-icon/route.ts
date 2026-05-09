import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { writeFile } from 'fs/promises';
import path from 'path';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const fd = await req.formData();
  const file = fd.get('icon') as File | null;
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'too_large' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const publicDir = path.join(process.cwd(), 'public');

  await Promise.all([
    writeFile(path.join(publicDir, 'icon-192.png'), buffer),
    writeFile(path.join(publicDir, 'icon-512.png'), buffer),
  ]);

  return NextResponse.json({ ok: true });
}
