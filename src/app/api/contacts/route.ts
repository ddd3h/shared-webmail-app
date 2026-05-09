import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const sp = new URL(req.url).searchParams;
  const q = sp.get('q') || '';
  const emailsParam = sp.get('emails') || '';

  // Batch exact-match lookup for a list of email addresses
  if (emailsParam) {
    const list = emailsParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const contacts = await prisma.contacts.findMany({
      where: { email: { in: list, mode: 'insensitive' } },
      select: { id: true, name: true, email: true },
    });
    return NextResponse.json({ contacts });
  }

  const contacts = await prisma.contacts.findMany({
    where: q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ]
    } : undefined,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, phone: true, company: true, department: true, notes: true, source: true, created_at: true }
  });

  return NextResponse.json({ contacts });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  const body = await req.json();
  const { name, email, phone, company, department, notes } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'name_required' }, { status: 400 });

  const contact = await prisma.contacts.create({
    data: { name: name.trim(), email: email?.trim() || null, phone: phone?.trim() || null, company: company?.trim() || null, department: department?.trim() || null, notes: notes?.trim() || null, source: 'manual', created_by: session.userId }
  });

  return NextResponse.json(contact, { status: 201 });
}
