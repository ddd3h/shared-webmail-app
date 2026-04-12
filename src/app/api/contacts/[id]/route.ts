import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  const { name, email, phone, company, department, notes } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const contact = await prisma.contacts.update({
    where: { id },
    data: { name: name.trim(), email: email?.trim() || null, phone: phone?.trim() || null, company: company?.trim() || null, department: department?.trim() || null, notes: notes?.trim() || null }
  });

  return NextResponse.json(contact);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);

  await prisma.contacts.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
