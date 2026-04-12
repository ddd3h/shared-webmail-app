import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

// POST /api/user/storage-recalc
// Recalculates and caches storage usage for the current user's personal mailboxes.
export async function POST() {
  const session = await getSession();
  requireAuth(session);

  const mailboxes = await prisma.mailboxes.findMany({
    where: { type: 'personal', owner_user_id: session!.userId },
    select: { id: true }
  });

  const results = await Promise.all(mailboxes.map(async mb => {
    const rows = await prisma.$queryRaw<[{ total: bigint }]>`
      SELECT (
        COALESCE(SUM(LENGTH(m.text_body)), 0) +
        COALESCE(SUM(LENGTH(m.html_body)), 0) +
        COALESCE((SELECT SUM(a.size) FROM attachments a JOIN messages m2 ON a.message_id = m2.id WHERE m2.mailbox_id = ${mb.id}), 0)
      )::bigint AS total
      FROM messages m
      WHERE m.mailbox_id = ${mb.id}
    `;
    const usedBytes = rows[0].total;
    await prisma.mailboxes.update({
      where: { id: mb.id },
      data: { cached_size_bytes: usedBytes, size_cached_at: new Date() }
    });
    return { id: mb.id, used_bytes: Number(usedBytes) };
  }));

  return NextResponse.json({ ok: true, results });
}
