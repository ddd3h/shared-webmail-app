import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { copyFile, writeFile } from 'fs/promises';
import path from 'path';
import { APP_ROOT } from '@/lib/app-root';

// Android's status-bar push notification icon (Notification.badge) is rendered
// from the alpha channel only — it must be a transparent-background silhouette,
// unlike the full-color app icon (icon-192.png). Kept as its own static file so
// public/sw.js can reference a fixed path without payload plumbing.
const ALLOWED_TYPES = ['image/png', 'image/webp'];
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB — this is a small status-bar glyph, not a full icon
const BADGE_PATH = () => path.join(APP_ROOT, 'public', 'icon-badge.png');
const DEFAULT_BADGE_PATH = () => path.join(APP_ROOT, 'src', 'assets', 'default-icon-badge.png');

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const fd = await req.formData();
  const file = fd.get('badge') as File | null;
  if (!file) return NextResponse.json({ error: 'no_file' }, { status: 400 });
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'invalid_type' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'too_large' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(BADGE_PATH(), buffer);

  return NextResponse.json({ ok: true });
}

// DELETE - restore the app's built-in default badge icon
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  await copyFile(DEFAULT_BADGE_PATH(), BADGE_PATH());
  return NextResponse.json({ ok: true });
}
