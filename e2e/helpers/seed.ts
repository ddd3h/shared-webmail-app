import { hashPassword } from '../../src/lib/password';
import { db } from './db';
import { MAILBOX_ID, PASSWORD, RATE_IDS, USERS } from './constants';

const jstDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
// a JST wall-clock time today as an instant
export const todayAt = (hhmm: string) => new Date(`${jstDate()}T${hhmm}:00+09:00`);
export { jstDate };

async function truncateAll() {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'`
  );
  if (rows.length === 0) return;
  await db.$executeRawUnsafe(`TRUNCATE ${rows.map(r => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

// Wipes everything and recreates the fixed baseline: users of every kind, a shared mailbox with
// graded permissions, the 手当 rate master, and a calendar that already has events.
export async function seedBase() {
  await truncateAll();
  const hash = await hashPassword(PASSWORD, { N: 1024 }); // cheap cost factor: the tests log in a lot
  for (const u of Object.values(USERS)) {
    await db.users.create({ data: { id: u.id, name: u.name, email: u.email, role: u.role, worker_type: u.worker_type, is_accounting: !!u.is_accounting, password_hash: hash } });
  }

  await db.mailboxes.create({ data: { id: MAILBOX_ID, type: 'team', display_name: '営業チーム共有', email_address: 'sales@e2e.test', is_active: true } });
  await db.mailbox_permissions.createMany({
    data: [
      { mailbox_id: MAILBOX_ID, user_id: USERS.admin.id, can_view: true, can_reply: true, can_assign: true },
      { mailbox_id: MAILBOX_ID, user_id: USERS.admin2.id, can_view: true, can_reply: false, can_assign: false },
      { mailbox_id: MAILBOX_ID, user_id: USERS.sato.id, can_view: true, can_reply: true, can_assign: false },
      { mailbox_id: MAILBOX_ID, user_id: USERS.tanaka.id, can_view: true, can_reply: false, can_assign: false },
    ],
  });

  await db.trip_allowance_types.createMany({
    data: [
      { id: RATE_IDS.domestic, name: '国内出張日当', kind: 'daily', unit: 'per_day', amount: 3000, description: '国内への出張（1日あたり）', sort: 10 },
      { id: RATE_IDS.overseas, name: '海外出張日当', kind: 'daily', unit: 'per_day', amount: 6000, description: '海外への出張（1日あたり）', sort: 20 },
      { id: RATE_IDS.onsite, name: '現場作業手当', kind: 'addon', unit: 'per_day', amount: 1000, description: '客先・現場での作業がある場合', sort: 30 },
      { id: RATE_IDS.resident, name: '客先常駐手当', kind: 'addon', unit: 'per_day', amount: 2000, description: '客先に常駐して業務を行う場合', sort: 40 },
      { id: RATE_IDS.lodging, name: '宿泊手当', kind: 'addon', unit: 'per_night', amount: 2000, description: '宿泊を伴う場合（1泊あたり）', sort: 50 },
      { id: RATE_IDS.event, name: '展示会・イベント対応手当', kind: 'addon', unit: 'per_trip', amount: 5000, description: '展示会やイベントでの対応がある場合', sort: 60 },
    ],
  });
  await seedCalendar();
}

export async function seedCalendar() {
  await db.calendar_events.deleteMany({});
  await db.calendar_google_links.deleteMany({});
  const now = new Date();
  // Two Google links: sato's in 予定ありのみ mode, admin2's showing details. `last_synced_at` is fresh so no sync is attempted.
  await db.calendar_google_links.create({
    data: { id: 'l_busy', mailbox_id: MAILBOX_ID, linked_by_user_id: USERS.sato.id, encrypted_token: 'x', google_calendar_id: 'primary', name: '佐藤さんのGoogleカレンダー', color: '#10b981', display_mode: 'busy_only', busy_label: '予定あり', last_synced_at: now },
  });
  await db.calendar_google_links.create({
    data: { id: 'l_full', mailbox_id: MAILBOX_ID, linked_by_user_id: USERS.admin2.id, encrypted_token: 'x', google_calendar_id: 'team', name: '副管理者Google', color: '#f59e0b', display_mode: 'full', busy_label: '予定あり', last_synced_at: now },
  });
  await db.calendar_events.createMany({
    data: [
      { id: 'ev_local', mailbox_id: MAILBOX_ID, source: 'local', title: '週次ミーティング', location: '会議室A', start_at: todayAt('10:00'), end_at: todayAt('11:00'), created_by_id: USERS.admin.id },
      { id: 'ev_busy', mailbox_id: MAILBOX_ID, source: 'google', link_id: 'l_busy', google_event_id: 'g1', title: null, owner_user_id: USERS.sato.id, start_at: todayAt('14:00'), end_at: todayAt('15:00') },
      { id: 'ev_renamed', mailbox_id: MAILBOX_ID, source: 'google', link_id: 'l_busy', google_event_id: 'g2', title: null, title_override: '社内MTG', owner_user_id: USERS.sato.id, start_at: todayAt('16:00'), end_at: todayAt('17:00') },
      { id: 'ev_full', mailbox_id: MAILBOX_ID, source: 'google', link_id: 'l_full', google_event_id: 'g3', title: '全体会議', location: '大会議室', description: '四半期レビュー', owner_user_id: USERS.admin2.id, start_at: todayAt('13:00'), end_at: todayAt('14:00') },
    ],
  });
}

// ---- per-feature cleanups (specs call these in beforeAll so they never depend on each other) ----
export async function resetExpenses() {
  await db.expense_claims.deleteMany({});
}
export async function resetPayslips() {
  await db.payslips.deleteMany({});
}
export async function resetTrips() {
  await db.expense_claims.deleteMany({});
  await db.business_trips.deleteMany({});
}
export async function resetPayments() {
  await db.payment_requests.deleteMany({});
  await db.payment_vendors.deleteMany({});
}
// 全銀: batches, everybody's receiving account, the company header settings, and payment/payslip rows that point at batches
export async function resetTransfers() {
  await db.transfer_batches.deleteMany({});
  await db.user_bank_accounts.deleteMany({});
  await db.payslips.deleteMany({});
  await db.expense_claims.deleteMany({});
  await db.payment_requests.deleteMany({});
  await db.payment_vendors.deleteMany({});
  await db.app_settings.deleteMany({ where: { key: { startsWith: 'ZENGIN_' } } });
}
export async function resetWork() {
  await db.attendance_records.deleteMany({});
  await db.work_reports.deleteMany({});
  await db.app_settings.deleteMany({ where: { key: { in: ['WORK_DAILY_MINUTES', 'WORK_AUTO_BREAK_MINUTES'] } } });
}
export async function setWorkerType(userId: string, worker_type: 'employee' | 'contractor' | 'quasi_contractor' | 'executive' | 'regular' | 'part' | 'dispatch') {
  await db.users.update({ where: { id: userId }, data: { worker_type } });
}
export async function clearNotifications() {
  await db.mattermost_notifications.deleteMany({});
}

// 組織と人事評価: periods/forms, 部署, 役職, and everybody's placement
export async function resetOrg() {
  await db.eval_cycles.deleteMany({}); // forms and scores go with them
  await db.org_unit_extra_members.deleteMany({});
  await db.users.updateMany({ data: { org_unit_id: null, position_id: null } });
  await db.org_units.deleteMany({});
  await db.org_positions.deleteMany({});
  await db.expense_claims.deleteMany({});
  await db.business_trips.deleteMany({});
}

// セキュリティ: blocks, events, locks, logins and known devices of earlier tests must not influence the next one
export async function resetSecurity() {
  await db.ip_blocks.deleteMany({});
  await db.security_events.deleteMany({});
  await db.known_devices.deleteMany({});
  await db.login_logs.deleteMany({});
  await db.users.updateMany({ data: { locked_at: null } });
  await db.sessions.deleteMany({ where: { user_id: 'u_guest' } });
  await db.app_settings.deleteMany({ where: { key: { in: ['SECURITY_ALLOWED_CIDRS', 'SECURITY_ALLOWED_COUNTRIES', 'SECURITY_SESSION_MAX_DAYS', 'SECURITY_NEW_DEVICE_ALERT', 'SECURITY_MFA_TRUST_DAYS'] } } });
  await db.app_settings.upsert({ where: { key: 'SECURITY_REQUIRE_2FA' }, create: { key: 'SECURITY_REQUIRE_2FA', value: 'off' }, update: { value: 'off' } });
  await db.app_settings.upsert({ where: { key: 'SECURITY_DEVICE_BINDING' }, create: { key: 'SECURITY_DEVICE_BINDING', value: 'off' }, update: { value: 'off' } });
  await db.app_settings.upsert({ where: { key: 'SECURITY_IDLE_MINUTES' }, create: { key: 'SECURITY_IDLE_MINUTES', value: '0' }, update: { value: '0' } });
}
