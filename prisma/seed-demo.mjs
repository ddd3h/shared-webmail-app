// Demo data for a test server: people, a team mailbox with mail, calendar, to-dos, attendance, expenses, trips,
// pay statements, bank accounts, vendors and transfer requests, an organisation and an evaluation cycle.
//
//   npm run seed:demo              add (or refresh) the demo data
//   npm run seed:demo -- --reset   remove the demo data again
//   npm run seed:demo -- --relax-security   also turn off "password + 2FA" and the device check (so you can log in with the password alone)
//
// Safe to run again: every row has a fixed id starting with "demo_", so it is updated, not duplicated. Nothing that was
// not made by this script is changed or deleted. It refuses to run when NODE_ENV=production (add --allow-production).
import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt, webcrypto } from 'crypto';
import { promisify } from 'util';

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Passw0rd!';
const DOMAIN = 'demo.example.com';

// ---- the same password hash and encryption the app uses (src/lib/password.ts, src/lib/crypto.ts) ----
const scryptAsync = promisify(scrypt);
async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$64$${salt.toString('base64')}$${key.toString('base64')}`;
}
const keyHex = process.env.ENCRYPTION_KEY_HEX || '';
const canEncrypt = /^([0-9a-fA-F]{2}){32}$/.test(keyHex);
async function encrypt(text) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey('raw', Buffer.from(keyHex, 'hex'), { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return Buffer.concat([Buffer.from(iv), Buffer.from(new Uint8Array(ct))]).toString('base64');
}

// ---- dates: Japan time, relative to today ----
const jstNow = new Date(Date.now() + 9 * 3600_000);
const ymd = (offset = 0) => new Date(jstNow.getTime() + offset * 86400_000).toISOString().slice(0, 10);
const day = (offset = 0) => new Date(`${ymd(offset)}T00:00:00Z`);               // for @db.Date columns
const at = (offset, hhmm) => new Date(`${ymd(offset)}T${hhmm}:00+09:00`);        // an instant
const ago = (hours) => new Date(Date.now() - hours * 3600_000);
const weekdayOf = (offset) => new Date(`${ymd(offset)}T00:00:00Z`).getUTCDay();

const up = (model, id, data) => prisma[model].upsert({ where: { id }, create: { id, ...data }, update: data });

const U = { admin: 'demo_admin', keiri: 'demo_keiri', sato: 'demo_sato', tanaka: 'demo_tanaka', suzuki: 'demo_suzuki', yamada: 'demo_yamada' };
const MB = { team: 'demo_mb_team', admin: 'demo_mb_admin' };

async function reset() {
  const demoUsers = { user_id: { startsWith: 'demo_' } };
  await prisma.messages.deleteMany({ where: { mailbox_id: { startsWith: 'demo_' } } });
  await prisma.threads.deleteMany({ where: { mailbox_id: { startsWith: 'demo_' } } });
  await prisma.mailbox_permissions.deleteMany({ where: { mailbox_id: { startsWith: 'demo_' } } });
  await prisma.mailboxes.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.payment_requests.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.payment_vendors.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.transfer_batches.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.eval_cycles.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.trip_allowance_types.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.todos.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.calendar_events.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.users.deleteMany({ where: { id: { startsWith: 'demo_' } } }); // the rest (attendance, expenses, pay statements, ...) goes with them
  await prisma.org_units.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  await prisma.org_positions.deleteMany({ where: { id: { startsWith: 'demo_' } } });
  console.log('✓ デモデータを削除しました');
  void demoUsers;
}

async function people() {
  const hash = await hashPassword(PASSWORD);
  const rows = [
    [U.admin, '管理者', 'admin', 'employee', true],
    [U.keiri, '経理 花子', 'user', 'employee', false, true],
    [U.sato, '佐藤 太郎', 'user', 'employee'],
    [U.tanaka, '田中 次郎', 'user', 'employee'],
    [U.suzuki, '鈴木 三郎（業務委託）', 'user', 'contractor'],
    [U.yamada, '山田 役員', 'user', 'executive'],
  ];
  for (const [id, name, role, worker_type, , isAccounting] of rows) {
    const email = `${id.replace('demo_', 'demo-')}@${DOMAIN}`;
    await up('users', id, { name, email, role, worker_type, is_accounting: !!isAccounting, password_hash: hash, signature: `${name}\n${email}` });
  }
}

async function organisation() {
  const pos = {};
  for (const [key, name, level, permissions] of [['head', '部長', 30, ['approve_requests', 'evaluate']], ['lead', '課長', 20, ['approve_requests', 'evaluate']], ['member', 'メンバー', 10, []]]) {
    const existing = await prisma.org_positions.findUnique({ where: { name } }); // a position of that name that is not ours is used as it is
    pos[key] = existing?.id ?? `demo_pos_${key}`;
    if (!existing) await up('org_positions', pos[key], { name, level, permissions });
  }
  await up('org_units', 'demo_unit_hq', { name: 'デモ株式会社', head_user_id: U.yamada, sort: 0 });
  await up('org_units', 'demo_unit_sales', { name: '営業部', parent_id: 'demo_unit_hq', head_user_id: U.sato, sort: 1 });
  await up('org_units', 'demo_unit_admin', { name: '管理部', parent_id: 'demo_unit_hq', head_user_id: U.keiri, sort: 2 });
  const place = { [U.yamada]: ['demo_unit_hq', pos.head], [U.sato]: ['demo_unit_sales', pos.lead], [U.tanaka]: ['demo_unit_sales', pos.member], [U.suzuki]: ['demo_unit_sales', pos.member], [U.keiri]: ['demo_unit_admin', pos.lead], [U.admin]: ['demo_unit_admin', pos.head] };
  for (const [id, [org_unit_id, position_id]] of Object.entries(place)) await prisma.users.update({ where: { id }, data: { org_unit_id, position_id } });
}

async function mail() {
  await up('mailboxes', MB.team, { type: 'team', display_name: '営業チーム共有', email_address: `sales@${DOMAIN}`, is_active: true });
  await up('mailboxes', MB.admin, { type: 'personal', display_name: '管理者', email_address: `demo-admin@${DOMAIN}`, owner_user_id: U.admin, is_active: true });
  const perms = [[U.admin, true, true, true], [U.sato, true, true, false], [U.tanaka, true, false, false], [U.keiri, true, true, false], [U.yamada, true, false, false]];
  for (const [user_id, can_view, can_reply, can_assign] of perms) {
    await prisma.mailbox_permissions.upsert({ where: { mailbox_id_user_id: { mailbox_id: MB.team, user_id } }, create: { mailbox_id: MB.team, user_id, can_view, can_reply, can_assign }, update: { can_view, can_reply, can_assign } });
  }
  const threads = [
    ['見積もりのご依頼', '山本 様', 'yamamoto@client-a.example.jp', 'お世話になっております。新サービスの見積もりをお願いできますでしょうか。', 2, 'open', null, false],
    ['請求書の送付について', '経理担当', 'accounting@client-b.example.jp', '10月分の請求書をお送りします。ご確認ください。', 5, 'in_progress', U.sato, false],
    ['打ち合わせ日程のご相談', '高橋 様', 'takahashi@client-c.example.jp', '来週のどこかで30分ほどお時間をいただけますか。', 20, 'waiting', U.tanaka, true],
    ['資料のお礼', '小林 様', 'kobayashi@client-d.example.jp', '先日はありがとうございました。資料を拝見しました。', 50, 'done', U.sato, true],
    ['納期の確認', '渡辺 様', 'watanabe@client-e.example.jp', '部品の納期について確認させてください。', 8, 'open', null, false],
    ['【至急】システム障害のご連絡', '運用チーム', 'ops@client-f.example.jp', '本日未明からログインできない状況です。', 1, 'in_progress', U.admin, false],
  ];
  for (const [i, [subject, from_name, from_email, body, hoursAgo, status, assigned_user_id, readBySato]] of threads.entries()) {
    const id = `demo_th_${i + 1}`, when = ago(hoursAgo);
    await up('threads', id, { mailbox_id: MB.team, subject, normalized_subject: subject, status, assigned_user_id, last_message_at: when, last_received_at: when, unread_count: 0 });
    await up('messages', `demo_msg_${i + 1}`, { thread_id: id, mailbox_id: MB.team, external_message_id: `<demo-${i + 1}@${DOMAIN}>`, direction: 'incoming', from_name, from_email, to_raw: `sales@${DOMAIN}`, subject, text_body: body, sent_at: when, received_at: when });
    if (status === 'done' || status === 'waiting') {
      const reply = new Date(when.getTime() + 1800_000);
      await up('messages', `demo_msg_${i + 1}r`, { thread_id: id, mailbox_id: MB.team, external_message_id: `<demo-${i + 1}r@${DOMAIN}>`, direction: 'outgoing', from_name: '営業チーム', from_email: `sales@${DOMAIN}`, to_raw: from_email, subject: `Re: ${subject}`, text_body: 'ご連絡ありがとうございます。確認のうえ、改めてご連絡いたします。', sent_at: reply });
      await prisma.threads.update({ where: { id }, data: { last_message_at: reply, last_sent_at: reply, last_replied_by_user_id: U.sato } });
    }
    if (readBySato) await prisma.thread_reads.upsert({ where: { thread_id_user_id: { thread_id: id, user_id: U.sato } }, create: { thread_id: id, user_id: U.sato }, update: { last_read_at: new Date() } });
  }
  for (const [i, [subject, from_name, from_email, body]] of [['週次レポートの共有', 'メルマガ配信', 'news@example.net', '今週のレポートをお送りします。'], ['ご利用ありがとうございます', 'サービス窓口', 'support@example.org', 'お問い合わせを受け付けました。']].entries()) {
    const id = `demo_th_p${i + 1}`, when = ago(3 + i * 10);
    await up('threads', id, { mailbox_id: MB.admin, subject, normalized_subject: subject, status: 'open', last_message_at: when, last_received_at: when, unread_count: 1 });
    await up('messages', `demo_msg_p${i + 1}`, { thread_id: id, mailbox_id: MB.admin, external_message_id: `<demo-p${i + 1}@${DOMAIN}>`, direction: 'incoming', from_name, from_email, to_raw: `demo-admin@${DOMAIN}`, subject, text_body: body, sent_at: when, received_at: when });
  }
}

async function calendarAndTodos() {
  const events = [
    ['朝会', 0, '09:30', '10:00', null], ['週次ミーティング', 0, '10:00', '11:00', null], ['A社 打ち合わせ', 0, '14:00', '15:30', U.sato],
    ['見積書レビュー', 1, '11:00', '12:00', U.tanaka], ['全社会議', 2, '15:00', '16:30', null], ['B社 訪問', 3, '13:00', '17:00', U.sato], ['新人研修', 4, '10:00', '12:00', U.yamada],
  ];
  for (const [i, [title, offset, from, to, owner]] of events.entries()) {
    await up('calendar_events', `demo_ev_${i + 1}`, { mailbox_id: MB.team, source: 'local', title, start_at: at(offset, from), end_at: at(offset, to), owner_user_id: owner, created_by_id: U.admin });
  }
  await up('calendar_events', 'demo_ev_allday', { mailbox_id: MB.team, source: 'local', title: '創立記念日', all_day: true, start_at: day(5), end_at: day(6), created_by_id: U.admin });
  const todos = [
    ['A社への見積書を送る', -1, U.sato, null, '最新の単価表を使うこと'], ['月次レポートの確認', 0, U.admin, null, null], ['展示会の備品を発注', 0, null, null, null],
    ['来月のシフトを調整', 3, U.sato, null, null], ['契約書のひな形を更新', null, null, null, '法務の確認待ち'], ['請求書を送付', -2, U.sato, true, null],
  ];
  for (const [i, [title, due, assignee_id, done, description]] of todos.entries()) {
    await up('todos', `demo_todo_${i + 1}`, { mailbox_id: MB.team, title, description, due_date: due === null ? null : day(due), assignee_id, created_by_id: U.admin, done_at: done ? new Date() : null, done_by_id: done ? U.sato : null });
  }
}

async function work() {
  for (let back = 1, made = 0; made < 10 && back < 30; back++) { // the last ten working days
    const wd = weekdayOf(-back);
    if (wd === 0 || wd === 6) continue;
    made++;
    await up('attendance_records', `demo_att_sato_${back}`, { user_id: U.sato, work_date: day(-back), clock_in_at: at(-back, made % 3 === 0 ? '09:15' : '08:58'), clock_out_at: at(-back, made % 4 === 0 ? '20:10' : '18:05'), break_minutes: 60 });
    await up('attendance_records', `demo_att_tanaka_${back}`, { user_id: U.tanaka, work_date: day(-back), clock_in_at: at(-back, '09:00'), clock_out_at: at(-back, '18:00'), break_minutes: 60 });
  }
  const reports = [['A社 システム保守', -1, '障害対応と定期メンテナンス', 6.5], ['B社 資料作成', -2, '提案資料の作成', 4], ['定例会議・議事録', -4, '週次会議の参加と議事録', 2.5]];
  for (const [i, [title, off, content, hours]] of reports.entries()) await up('work_reports', `demo_rep_${i + 1}`, { user_id: U.suzuki, report_date: day(off), title, content, hours });

  const month = (back) => { const d = new Date(jstNow.getFullYear(), jstNow.getMonth() - back, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const slips = [
    ['demo_pay_sato_prev', U.sato, month(1), '給与', 'paid', [['earning', '基本給', 320000], ['earning', '通勤手当', 12000], ['deduction', '社会保険', 48000], ['deduction', '所得税', 8200]]],
    ['demo_pay_sato_now', U.sato, month(0), '給与', 'planned', [['earning', '基本給', 320000], ['earning', '通勤手当', 12000], ['earning', '残業手当', 21000], ['deduction', '社会保険', 48000], ['deduction', '所得税', 8800]]],
    ['demo_pay_tanaka_now', U.tanaka, month(0), '給与', 'planned', [['earning', '基本給', 280000], ['deduction', '社会保険', 41000]]],
    ['demo_pay_suzuki_prev', U.suzuki, month(1), '報酬', 'paid', [['earning', '業務委託報酬', 400000]]],
  ];
  for (const [id, user_id, pay_month, title, status, items] of slips) {
    await up('payslips', id, { user_id, pay_month, title, status, pay_date: status === 'paid' ? day(-7) : day(14), created_by_id: U.admin });
    await prisma.payslip_items.deleteMany({ where: { payslip_id: id } });
    await prisma.payslip_items.createMany({ data: items.map(([kind, label, amount], sort) => ({ payslip_id: id, kind, label, amount, sort })) });
  }
}

async function trips() {
  const types = [['demo_tat_domestic', '国内出張日当', 'daily', 'per_day', 3000], ['demo_tat_overseas', '海外出張日当', 'daily', 'per_day', 6000], ['demo_tat_lodging', '宿泊手当', 'addon', 'per_night', 2000]];
  for (const [i, [id, name, kind, unit, amount]] of types.entries()) await up('trip_allowance_types', id, { name, kind, unit, amount, sort: (i + 1) * 10 });
  const list = [
    ['demo_trip_1', U.sato, '大阪', 'A社 システム導入の立ち会い', 3, 4, 'approved'], ['demo_trip_2', U.tanaka, '名古屋', '展示会の出展', 8, 9, 'pending'], ['demo_trip_3', U.sato, '福岡', '顧客訪問', -10, -8, 'approved'],
  ];
  for (const [id, user_id, destination, purpose, s, e, status] of list) {
    await up('business_trips', id, { user_id, destination, purpose, start_date: day(s), end_date: day(e), status, ...(status === 'pending' ? {} : { reviewed_by_id: U.sato, reviewed_at: new Date() }) });
    const days = e - s + 1, nights = days - 1;
    await prisma.trip_allowance_lines.deleteMany({ where: { trip_id: id } });
    await prisma.trip_allowance_lines.createMany({ data: [
      { trip_id: id, type_id: 'demo_tat_domestic', name: '国内出張日当', kind: 'daily', unit: 'per_day', rate: 3000, quantity: days, amount: 3000 * days, sort: 0 },
      ...(nights > 0 ? [{ trip_id: id, type_id: 'demo_tat_lodging', name: '宿泊手当', kind: 'addon', unit: 'per_night', rate: 2000, quantity: nights, amount: 2000 * nights, sort: 1 }] : []),
    ] });
  }
  const claims = [
    ['demo_claim_1', U.sato, -2, '交通費', 'A社訪問の交通費', 1480, 'personal', 'pending', null], ['demo_claim_2', U.sato, -6, '書籍・資料', '業務書籍の購入', 3200, 'personal', 'approved', null],
    ['demo_claim_3', U.sato, -12, '宿泊費', '福岡出張の宿泊', 12000, 'personal', 'paid', 'demo_trip_3'], ['demo_claim_4', U.tanaka, -1, '会議費', 'チームランチ', 8400, 'company', 'pending', null],
    ['demo_claim_5', U.tanaka, -9, '交通費', 'タクシー代', 2300, 'personal', 'rejected', null],
  ];
  for (const [id, user_id, off, category, title, amount, payment_method, status, trip_id] of claims) {
    await up('expense_claims', id, { user_id, expense_date: day(off), category, title, amount, payment_method, status, trip_id, ...(status === 'pending' ? {} : { reviewed_by_id: U.sato, reviewed_at: new Date(), review_comment: status === 'rejected' ? '領収書の日付が確認できません' : null }), ...(status === 'paid' ? { reimbursed_at: day(-3), reimbursed_by_id: U.keiri } : {}) });
  }
}

async function money() {
  if (!canEncrypt) { console.log('! ENCRYPTION_KEY_HEX が未設定のため、受取口座・取引先・振込申請は作りませんでした'); return; }
  const accounts = [[U.sato, 'みずほ銀行', '0001', '新宿支店', '123', '1234567', 'サトウ タロウ', true], [U.tanaka, '三菱UFJ銀行', '0005', '渋谷支店', '234', '2345678', 'タナカ ジロウ', false], [U.suzuki, '三井住友銀行', '0009', '大阪支店', '345', '3456789', 'スズキ サブロウ', true]];
  for (const [user_id, bank_name, bank_code, branch_name, branch_code, number, account_holder, verified] of accounts) {
    await prisma.user_bank_accounts.upsert({
      where: { user_id },
      create: { user_id, bank_name, bank_code, branch_name, branch_code, account_type: 'ordinary', account_number_enc: await encrypt(number), account_last4: number.slice(-4), account_holder, verified_at: verified ? new Date() : null, verified_by_id: verified ? U.keiri : null },
      update: { bank_name, bank_code, branch_name, branch_code, account_number_enc: await encrypt(number), account_last4: number.slice(-4), account_holder, verified_at: verified ? new Date() : null, verified_by_id: verified ? U.keiri : null },
    });
  }
  const vendors = [['demo_vendor_1', '株式会社テスト商事', 'カ）テストショウジ', 'みずほ銀行', '0001', '日本橋支店', '101', '7654321', true], ['demo_vendor_2', '有限会社サンプル工業', 'ユ）サンプルコウギョウ', '三菱UFJ銀行', '0005', '大阪支店', '202', '6543210', false]];
  for (const [id, name, kana, bank_name, bank_code, branch_name, branch_code, number, verified] of vendors) {
    await up('payment_vendors', id, { name, bank_name, bank_code, branch_name, branch_code, account_type: 'ordinary', account_number_enc: await encrypt(number), account_last4: number.slice(-4), account_holder: kana, verified_at: verified ? new Date() : null, verified_by_id: verified ? U.keiri : null, created_by_id: U.admin });
  }
  const reqs = [['demo_req_1', U.sato, 'demo_vendor_1', '10月分 外注費', 110000, 'pending'], ['demo_req_2', U.sato, 'demo_vendor_1', '備品代', 33000, 'approved'], ['demo_req_3', U.tanaka, 'demo_vendor_1', '9月分 外注費', 88000, 'paid']];
  for (const [id, user_id, vendor_id, title, amount, status] of reqs) {
    await up('payment_requests', id, { user_id, vendor_id, title, amount, due_date: day(status === 'paid' ? -10 : 7), status, ...(status === 'pending' ? {} : { reviewed_by_id: U.keiri, reviewed_at: new Date() }), ...(status === 'paid' ? { paid_at: day(-9), paid_by_id: U.keiri } : {}) });
  }
}

async function evaluations() {
  const crit = [['業務の成果', 3], ['チームワーク', 2], ['成長・学習', 1]];
  const cycles = [['demo_cycle_now', '2026年 下期評価', 'open', -60, 120], ['demo_cycle_prev', '2026年 上期評価', 'closed', -240, -61]];
  for (const [id, name, status, s, e] of cycles) {
    await up('eval_cycles', id, { name, period_start: day(s), period_end: day(e), status, opened_at: new Date(), ...(status === 'closed' ? { closed_at: new Date() } : {}), created_by_id: U.admin });
    for (const [i, [cname, weight]] of crit.entries()) await up('eval_criteria', `${id}_c${i + 1}`, { cycle_id: id, name: cname, weight, sort: i });
  }
  const forms = [
    ['demo_ev_now_tanaka', 'demo_cycle_now', U.tanaka, U.sato, { self: [4, 3, 4], manager: null }, false],
    ['demo_ev_now_suzuki', 'demo_cycle_now', U.suzuki, U.sato, { self: null, manager: null }, false],
    ['demo_ev_prev_tanaka', 'demo_cycle_prev', U.tanaka, U.sato, { self: [3, 4, 3], manager: [4, 4, 3] }, true],
  ];
  for (const [id, cycle_id, user_id, evaluator_id, scores, finalized] of forms) {
    await up('evaluations', id, { cycle_id, user_id, evaluator_id, self_submitted_at: scores.self ? new Date() : null, manager_submitted_at: scores.manager ? new Date() : null, ...(finalized ? { score: 3.8, grade: 'A', final_comment: '安定した成果でした', finalized_at: new Date(), finalized_by_id: U.admin } : {}) });
    for (let i = 0; i < crit.length; i++) {
      if (!scores.self && !scores.manager) continue;
      const criterion_id = `${cycle_id}_c${i + 1}`;
      await prisma.eval_scores.upsert({ where: { evaluation_id_criterion_id: { evaluation_id: id, criterion_id } }, create: { evaluation_id: id, criterion_id, self_score: scores.self?.[i] ?? null, manager_score: scores.manager?.[i] ?? null }, update: { self_score: scores.self?.[i] ?? null, manager_score: scores.manager?.[i] ?? null } });
    }
  }
}

async function relaxSecurity() {
  for (const [key, value] of [['SECURITY_REQUIRE_2FA', 'off'], ['SECURITY_DEVICE_BINDING', 'off']]) await prisma.app_settings.upsert({ where: { key }, create: { key, value }, update: { value } });
  console.log('✓ 「パスワード＋2段階認証」の必須と端末の確認をオフにしました（テスト用）');
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !args.has('--allow-production')) throw new Error('NODE_ENV=production のため中止しました。本当に本番へ入れるなら --allow-production を付けてください');
  const target = (process.env.DATABASE_URL || '').replace(/\/\/.*@/, '//***@');
  console.log(`対象のデータベース: ${target || '(DATABASE_URL 未設定)'}`);
  if (args.has('--reset')) return reset();
  await people(); await organisation(); await mail(); await calendarAndTodos(); await work(); await trips(); await money(); await evaluations();
  if (args.has('--relax-security')) await relaxSecurity();
  console.log('✓ デモデータを入れました');
  console.log(`  ログイン: demo-admin@${DOMAIN}（管理者）/ demo-keiri@${DOMAIN}（経理）/ demo-sato@${DOMAIN} / demo-tanaka@${DOMAIN} / demo-suzuki@${DOMAIN}（業務委託）/ demo-yamada@${DOMAIN}（役員）`);
  console.log(`  パスワード: ${PASSWORD}${args.has('--relax-security') ? '' : '  ※ 初回ログインは2段階認証の設定が必要です（パスワードだけで入るなら --relax-security）'}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
