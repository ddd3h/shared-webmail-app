import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { z } from 'zod';

export async function GET() {
  const session = await getSession();
  requireAuth(session);
  const users = await prisma.users.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      mattermost_user_id: true,
      mattermost_link_status: true,
      created_at: true
    },
    orderBy: { created_at: 'asc' }
  });
  return NextResponse.json({ items: users });
}

// POST - create user (admin only)
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const actor = await prisma.users.findUnique({ where: { id: session!.userId } });
  if (actor?.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(['user', 'admin']).default('user'),
    mattermost_user_id: z.string().nullable().optional()
  });

  const body = await req.json().catch(() => ({}));
  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'bad_request', details: result.error.format() }, { status: 400 });
  }
  const input = result.data;

  // Check for email uniqueness
  const existing = await prisma.users.findUnique({ where: { email: input.email } });
  if (existing) {
    return NextResponse.json({ error: 'email_already_exists' }, { status: 400 });
  }

  const hash = await hashPassword(input.password);

  const signatureTemplate = process.env.DEFAULT_SIGNATURE_TEMPLATE || `───────────────\n{{name}}\nChart株式会社\n\n〒350-0054\n埼玉県川越市三久保町15-2（3F）\nEmail: {{email}}\n───────────────`;
  const defaultSignature = signatureTemplate
    .replace(/\\n/g, '\n') // Handle escaped newlines in env
    .replace('{{name}}', input.name)
    .replace('{{email}}', input.email);

  const user = await prisma.users.create({
    data: {
      name: input.name,
      email: input.email,
      password_hash: hash,
      role: input.role,
      mattermost_user_id: input.mattermost_user_id || null,
      signature: defaultSignature
    }
  });

  return NextResponse.json({ id: user.id }, { status: 201 });
}
