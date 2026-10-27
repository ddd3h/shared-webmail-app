import { MAILBOX_ID, USERS } from './constants';
import { db } from './db';

export { MAILBOX_ID };
export const SUPPORT = 'mb_support';
export const GENERAL = 'mb_general';
export const BOX_NAMES = { [MAILBOX_ID]: '営業チーム共有', [SUPPORT]: 'サポート共有', [GENERAL]: '総務共有' };
export const SUBJECT = { [MAILBOX_ID]: '営業の見積依頼', [SUPPORT]: 'サポートへの問い合わせ', [GENERAL]: '総務の備品申請' };

export async function seed() {
  await cleanup();
  for (const [id, name, email] of [[SUPPORT, 'サポート共有', 'support@e2e.test'], [GENERAL, '総務共有', 'general@e2e.test']]) {
    await db.mailboxes.create({ data: { id, type: 'team', display_name: name, email_address: email, is_active: true } });
  }
  // sato may view all three; tanaka only 営業 and 総務; suzuki none
  await db.mailbox_permissions.createMany({ data: [
    { mailbox_id: SUPPORT, user_id: USERS.sato.id, can_view: true }, { mailbox_id: GENERAL, user_id: USERS.sato.id, can_view: true },
    { mailbox_id: GENERAL, user_id: USERS.tanaka.id, can_view: true },
  ] });
  for (const [i, mb] of ([MAILBOX_ID, SUPPORT, GENERAL] as const).entries()) {
    const at = new Date(Date.now() - (i + 1) * 3600_000);
    const subject = SUBJECT[mb];
    const t = await db.threads.create({ data: { mailbox_id: mb, subject, normalized_subject: subject, last_message_at: at, last_received_at: at, unread_count: 1 } });
    await db.messages.create({ data: { thread_id: t.id, mailbox_id: mb, external_message_id: `<tm-${mb}@e2e.test>`, direction: 'incoming', from_name: '送信者', from_email: 'x@example.com', to_raw: 'a@e2e.test', subject, text_body: '本文', sent_at: at, received_at: at } });
  }
}
export async function cleanup() {
  await db.hidden_team_mailboxes.deleteMany({});
  await db.thread_reads.deleteMany({});
  await db.messages.deleteMany({});
  await db.threads.deleteMany({});
  await db.mailbox_permissions.deleteMany({ where: { mailbox_id: { in: [SUPPORT, GENERAL] } } });
  await db.mailboxes.deleteMany({ where: { id: { in: [SUPPORT, GENERAL] } } });
}
