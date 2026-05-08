// Administrative notification emails sent via a dedicated no-reply SMTP account.
// All env vars are optional — if unset, this module silently becomes a no-op
// so the app works without notification SMTP configured.

import nodemailer from 'nodemailer';

function getTransport() {
  const host = process.env.NOTIFY_SMTP_HOST;
  const user = process.env.NOTIFY_SMTP_USER;
  const pass = process.env.NOTIFY_SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.NOTIFY_SMTP_PORT || '587', 10),
    secure: process.env.NOTIFY_SMTP_SECURE === 'true',
    auth: { user, pass },
  });
}

export async function sendNotificationEmail(subject: string, html: string): Promise<void> {
  const transport = getTransport();
  if (!transport) return;

  const from = process.env.NOTIFY_FROM_EMAIL || process.env.NOTIFY_SMTP_USER!;
  const to = process.env.NOTIFY_ADMIN_EMAIL;
  if (!to) return;

  await transport.sendMail({ from, to, subject, html });
}
