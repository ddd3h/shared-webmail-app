import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Public endpoint for VAPID public key (needed for push subscription)
export async function GET() {
  const setting = await prisma.app_settings.findUnique({
    where: { key: 'VAPID_PUBLIC_KEY' }
  });

  if (!setting?.value) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  return NextResponse.json({ publicKey: setting.value });
}
