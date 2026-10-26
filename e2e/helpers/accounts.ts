import { hashPassword } from '../../src/lib/password';
import { db } from './db';
import { PASSWORD } from './constants';

// Accounts made for tests that hammer a login or change a person's security settings: the limits live in the server's
// memory for 15 minutes, so they must never be spent on an account other specs log in with.
let counter = 0;
export async function newAccount(prefix = 'acct') {
  const email = `${prefix}-${Date.now().toString(36)}-${counter++}@e2e.test`;
  const user = await db.users.create({ data: { id: `u_${email.split('@')[0]}`, name: '試験用', email, role: 'user', worker_type: 'employee', password_hash: await hashPassword(PASSWORD, { N: 1024 }) } });
  return { id: user.id, email, mm: `mm-${email.split('@')[0]}` };
}
// the notification list keeps a row per person, so those go first
export async function deleteTestAccounts() {
  await db.notification_events.deleteMany({ where: { user_id: { startsWith: 'u_acct-' } } });
  return db.users.deleteMany({ where: { email: { contains: '@e2e.test' }, id: { startsWith: 'u_acct-' } } });
}
export async function deleteAccountsWithPrefix(prefix: string) {
  const where = { user_id: { startsWith: `u_${prefix}-` } };
  await db.mattermost_notifications.deleteMany({ where });
  await db.notification_events.deleteMany({ where });
  await db.users.deleteMany({ where: { id: { startsWith: `u_${prefix}-` } } });
}
