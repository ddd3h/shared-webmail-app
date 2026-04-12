import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, requireAuth } from '@/lib/auth';
import { testImapConnection } from '@/lib/mail/imap';
import { testSmtpConnection } from '@/lib/mail/smtp';
import { canViewMailbox } from '@/lib/rbac';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  requireAuth(session);
  if (!(await canViewMailbox(session!.userId, id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const cred = await prisma.mailbox_credentials.findUnique({ where: { mailbox_id: id } });
  if (!cred) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Run tests in parallel
  const [imap, smtp] = await Promise.all([
    testImapConnection({ host: cred.imap_host, port: cred.imap_port, secure: cred.imap_secure, auth: { user: cred.username, passEnc: cred.encrypted_password } }).catch((e) => ({ ok: false, error: String(e) })),
    testSmtpConnection({ host: cred.smtp_host, port: cred.smtp_port, secure: cred.smtp_secure, auth: { user: cred.username, passEnc: cred.encrypted_password } }).catch((e) => ({ ok: false, error: String(e) }))
  ]);

  const ok = imap.ok && smtp.ok;
  const status = ok ? 'success' : 'failed';
  const errMsg = ok ? null : ((imap as any).error || (smtp as any).error || 'unknown');
  await prisma.mailbox_credentials.update({
    where: { mailbox_id: id },
    data: { last_tested_at: new Date(), last_test_status: status, last_error: errMsg }
  });
  const message = ok
    ? 'IMAP/SMTP 接続に成功しました'
    : `接続失敗: ${errMsg}`;
  return NextResponse.json({ imap, smtp, status, ok, message });
}

