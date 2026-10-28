import { prisma } from '@/lib/db';

export const WHITELIST_NOTE = '「迷惑メールでない」から自動登録';

/** The distinct, lower-case sender addresses of some incoming messages. */
export function senderAddresses(rows: { from_email: string }[]): string[] {
  return [...new Set(rows.map(r => r.from_email.toLowerCase().trim()).filter(Boolean))];
}

/**
 * Puts each sender on the whitelist, so the next mail from them is not judged as spam again.
 * A sender who is already on the list is left as it is (the admin's note and owner stay).
 * The result is meant for prisma.$transaction, together with the other changes of the same action.
 */
export function whitelistUpserts(addresses: string[], userId: string) {
  return addresses.map(address =>
    prisma.spam_senders.upsert({
      where: { type_address: { type: 'whitelist', address } },
      create: { type: 'whitelist', address, note: WHITELIST_NOTE, created_by_id: userId },
      update: {},
    })
  );
}
