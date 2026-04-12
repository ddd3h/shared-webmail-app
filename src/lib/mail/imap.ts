import { decrypt } from '@/lib/crypto';

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean; // TLS
  auth: { user: string; passEnc: string };
};

export async function testImapConnection(cfg: ImapConfig) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.auth.user, pass: await decrypt(cfg.auth.passEnc) },
    logger: false,
    tls: { rejectUnauthorized: false }
  } as any);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e: any) {
    try { await client.logout(); } catch {}
    return { ok: false, error: String(e?.message || e) };
  }
}
