import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  requireAuth(session);

  // Join mailbox info with credentials and sync states
  const mailboxes = await prisma.mailboxes.findMany({
    select: {
      id: true,
      display_name: true,
      email_address: true,
      credentials: {
        select: {
          last_test_status: true,
          last_error: true,
          last_tested_at: true,
          imap_host: true,
          smtp_host: true
        }
      },
      sync_state: {
        select: {
          status: true,
          last_sync_started_at: true,
          last_success_at: true,
          last_error: true,
          updated_at: true
        }
      }
    }
  });

  const items = mailboxes.map((m) => ({
    mailbox_id: m.id,
    mailbox_name: m.display_name,
    mailbox_email: m.email_address,
    status: m.sync_state?.status || 'never',
    last_sync_started_at: m.sync_state?.last_sync_started_at || null,
    last_success_at: m.sync_state?.last_success_at || null,
    last_error: m.sync_state?.last_error || m.credentials?.last_error || null,
    last_test_status: m.credentials?.last_test_status || null,
    last_tested_at: m.credentials?.last_tested_at || null,
    imap_host: m.credentials?.imap_host || null,
    smtp_host: m.credentials?.smtp_host || null
  }));

  return NextResponse.json({ items });
}
