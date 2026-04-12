import nodemailer from 'nodemailer';
import { decrypt } from '@/lib/crypto';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean; // true for 465
  auth: { user: string; passEnc: string };
};

export async function testSmtpConnection(cfg: SmtpConfig) {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.auth.user, pass: await decrypt(cfg.auth.passEnc) }
  } as any);
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

