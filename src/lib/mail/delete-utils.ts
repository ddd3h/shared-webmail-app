export async function deleteImapMessagesBulk(
  cred: { imap_host: string; imap_port: number; imap_secure: boolean; username: string; encrypted_password: string },
  uids: number[]
) {
  if (uids.length === 0) return;
  const { decrypt } = await import('@/lib/crypto');
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cred.imap_host,
    port: cred.imap_port,
    secure: cred.imap_secure,
    auth: { user: cred.username, pass: await decrypt(cred.encrypted_password) },
    logger: false,
    tls: { rejectUnauthorized: false }
  } as any);

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uidRange = uids.join(',');
    await client.messageFlagsAdd(uidRange as any, ['\\Deleted'], { uid: true } as any);
    await (client as any).messageDelete(uidRange, { uid: true });
  } finally {
    lock.release();
    await client.logout();
  }
}
