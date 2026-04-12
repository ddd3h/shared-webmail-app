import { prisma } from '@/lib/db';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import MailComposer from 'nodemailer/lib/mail-composer';
import { decrypt } from '@/lib/crypto';
import path from 'path';

/**
 * Send (or retry sending) a pending message by its DB id.
 * Called inline from route handlers (fire-and-forget).
 */
export async function sendMailForMessage(messageId: string): Promise<void> {
  const msg = await prisma.messages.findUnique({
    where: { id: messageId },
    include: {
      thread: true,
      mailbox: { include: { credentials: true } },
      sends: true,
      attachments: true
    }
  });
  if (!msg || !msg.mailbox.credentials) {
    console.error('[send] message or credentials not found', messageId);
    return;
  }

  const cred = msg.mailbox.credentials;
  const transporter = nodemailer.createTransport({
    host: cred.smtp_host,
    port: cred.smtp_port,
    secure: cred.smtp_secure,
    auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) }
  } as any);

  const mailOptions: any = {
    from: msg.from_name ? `${msg.from_name} <${msg.from_email}>` : msg.from_email,
    to: msg.to_raw,
    cc: msg.cc_raw || undefined,
    bcc: msg.bcc_raw || undefined,
    subject: msg.subject,
    text: msg.text_body || undefined,
    html: msg.html_body || undefined,
    headers: {} as Record<string, string>
  };
  if (msg.in_reply_to) mailOptions.headers['In-Reply-To'] = msg.in_reply_to;
  if (msg.references_raw) mailOptions.headers['References'] = msg.references_raw;
  if (msg.attachments.length > 0) {
    mailOptions.attachments = msg.attachments.map(a => ({
      filename: a.filename,
      path: path.join(process.cwd(), a.storage_key),
      contentType: a.content_type
    }));
  }

  const sendRow = msg.sends.find((s) => s.status === 'pending');

  try {
    // Build raw MIME for Sent-folder APPEND
    const composer = new MailComposer(mailOptions);
    const raw: Buffer = await new Promise((resolve, reject) =>
      composer.compile().build((err: any, message: Buffer) => (err ? reject(err) : resolve(message)))
    );

    const info = await transporter.sendMail(mailOptions);

    await prisma.$transaction([
      prisma.messages.update({
        where: { id: msg.id },
        data: { external_message_id: info.messageId || msg.external_message_id }
      }),
      sendRow
        ? prisma.message_sends.update({
            where: { id: sendRow.id },
            data: { status: 'success', smtp_response: info.response ?? null, error_message: null, sent_at: new Date() }
          })
        : prisma.message_sends.create({
            data: {
              message_id: msg.id,
              thread_id: msg.thread_id,
              mailbox_id: msg.mailbox_id,
              sent_by_user_id: msg.thread.last_replied_by_user_id || '',
              status: 'success',
              smtp_response: info.response ?? null,
              error_message: null,
              sent_at: new Date()
            }
          }),
      prisma.threads.update({
        where: { id: msg.thread_id },
        data: { last_sent_at: new Date(), last_message_at: new Date() }
      })
    ]);

    // Append to Sent folder via IMAP (best-effort)
    try {
      const client = new ImapFlow({
        host: cred.imap_host,
        port: cred.imap_port,
        secure: cred.imap_secure,
        auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
        logger: false
      } as any);
      await client.connect();
      const sentFolders = ['Sent', 'Sent Items', 'INBOX.Sent', '送信済みメール'];
      let appended = false;
      for (const f of sentFolders) {
        try {
          await (client as any).append(f, raw, { flags: ['Seen'], internalDate: new Date() });
          appended = true;
          break;
        } catch {}
      }
      if (!appended) {
        try {
          await client.mailboxCreate('Sent');
          await (client as any).append('Sent', raw, { flags: ['Seen'], internalDate: new Date() });
        } catch {}
      }
      await client.logout();
    } catch (e) {
      console.warn('[send] append to Sent failed', e);
    }

    console.log('[send] success', msg.id, info.messageId);
  } catch (e: any) {
    if (sendRow) {
      await prisma.message_sends.update({
        where: { id: sendRow.id },
        data: { status: 'failed', error_message: String(e?.message || e) }
      });
    }
    console.error('[send] failed', msg.id, e?.message || e);
    throw e;
  }
}
