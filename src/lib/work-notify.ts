// Mattermost DMs for the expense / work-report / payslip / attendance features.
// Every function swallows its own errors so callers can fire and forget.
import { prisma } from '@/lib/db';
import { mmText, sendDirectMessage } from '@/lib/mattermost-dm';
import { PAYMENT_LABEL, type PaymentMethod } from '@/lib/expense';
import { approversOf } from '@/lib/org-server';

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

async function safely(label: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.error(`[work-notify] ${label} failed:`, e); }
}

async function adminsExcept(userId: string) {
  return prisma.users.findMany({ where: { role: 'admin', id: { not: userId } }, select: { id: true, email: true } });
}

// Admins plus the unit heads who may approve this person's requests, without the person themselves
async function reviewersOf(userId: string) {
  const [admins, heads] = await Promise.all([adminsExcept(userId), approversOf(userId)]);
  return [...new Map([...admins, ...heads].map(u => [u.id, u])).values()];
}

async function dmAll(users: { id: string; email: string }[], message: string, type: string) {
  await Promise.all(users.map(u => sendDirectMessage(u.id, u.email, message, type)));
}

// A new (or resubmitted) claim -> admins and the claimant's unit heads (never the claimant)
export function notifyExpenseSubmitted(claimId: string, resubmitted = false) {
  return safely('expense_submitted', async () => {
    const c = await prisma.expense_claims.findUnique({ where: { id: claimId }, include: { user: { select: { id: true, name: true } } } });
    if (!c) return;
    const msg =
      `🧾 **経費申請が${resubmitted ? '再申請されました' : '届きました'}**\n\n` +
      `**${mmText(c.user.name, 40)}** さん ・ **${yen(c.amount)}** ・ ${mmText(c.category, 20)}（${PAYMENT_LABEL[c.payment_method as PaymentMethod]}）\n` +
      `件名: ${mmText(c.title, 100)}\n\n` +
      `承認・却下: ${appUrl()}/approvals`;
    await dmAll(await reviewersOf(c.user_id), msg, 'expense_submitted');
  });
}

// Approved / rejected -> the claimant
export function notifyExpenseReviewed(claimId: string, action: 'approve' | 'reject') {
  return safely('expense_reviewed', async () => {
    const c = await prisma.expense_claims.findUnique({ where: { id: claimId }, include: { user: { select: { id: true, email: true } } } });
    if (!c) return;
    const label = `「${mmText(c.title, 100)}」 ${yen(c.amount)}`;
    const msg = action === 'approve'
      ? `✅ **経費申請が承認されました**\n\n${label}\n` +
        (c.payment_method === 'personal' ? '立替金は返金処理をお待ちください。' : '会社負担のため、これで完了です。') +
        `\n\n${appUrl()}/expenses`
      : `❌ **経費申請が却下されました**\n\n${label}\n理由: ${mmText(c.review_comment || '(なし)', 300)}\n\n修正して再申請: ${appUrl()}/expenses`;
    await sendDirectMessage(c.user.id, c.user.email, msg, `expense_${action === 'approve' ? 'approved' : 'rejected'}`);
  });
}

// Paid back -> one DM per claimant with their total
export function notifyExpenseReimbursed(claimIds: string[], paidDate: string, note?: string) {
  return safely('expense_reimbursed', async () => {
    const claims = await prisma.expense_claims.findMany({
      where: { id: { in: claimIds } },
      select: { amount: true, user: { select: { id: true, email: true } } },
    });
    const byUser = new Map<string, { email: string; count: number; total: number }>();
    for (const c of claims) {
      const e = byUser.get(c.user.id) ?? { email: c.user.email, count: 0, total: 0 };
      e.count++; e.total += c.amount; byUser.set(c.user.id, e);
    }
    await Promise.all([...byUser.entries()].map(([id, e]) => sendDirectMessage(id, e.email,
      `💴 **立替金が返金されました**\n\n${e.count}件 ・ 合計 **${yen(e.total)}**（返金日 ${paidDate}）` +
      (note ? `\nメモ: ${mmText(note, 200)}` : '') + `\n\n${appUrl()}/expenses`, 'expense_reimbursed')));
  });
}

// A contractor submitted a work report -> admins
export function notifyWorkReportSubmitted(reportId: string) {
  return safely('work_report', async () => {
    const r = await prisma.work_reports.findUnique({ where: { id: reportId }, include: { user: { select: { id: true, name: true } } } });
    if (!r) return;
    const hours = r.hours === null ? '' : ` ・ ${Number(r.hours)}h`;
    const warn = r.activity_flag ? '\n⚠️ **ログインの記録が少ない期間の報告です。**警告を読んだうえで、本人が提出しました。内容を確認してください。' : '';
    const msg = `📝 **業務報告書が提出されました**\n\n**${mmText(r.user.name, 40)}** さん ・ ${mmText(r.title, 100)}${hours}${warn}\n\n確認: ${appUrl()}/work`;
    await dmAll(await adminsExcept(r.user_id), msg, 'work_report');
  });
}

// A pay statement was registered / marked paid -> the person (amounts are deliberately left out of the DM)
export function notifyPayslip(payslipId: string, event: 'created' | 'paid') {
  return safely('payslip', async () => {
    const p = await prisma.payslips.findUnique({ where: { id: payslipId }, include: { user: { select: { id: true, email: true } } } });
    if (!p) return;
    const [y, m] = p.pay_month.split('-');
    const what = `${y}年${Number(m)}月分の${mmText(p.title, 40)}`;
    const msg = event === 'paid'
      ? `💴 **${what}が支払済になりました**\n\n明細の確認: ${appUrl()}/work`
      : `💴 **${what}の明細が登録されました**（${p.status === 'paid' ? '支払済' : '支払予定'}）\n\n明細の確認: ${appUrl()}/work`;
    await sendDirectMessage(p.user.id, p.user.email, msg, event === 'paid' ? 'payslip_paid' : 'payslip_created');
  });
}

// An admin corrected someone's attendance -> that person
export function notifyAttendanceEdited(targetUserId: string, workDate: string) {
  return safely('attendance_edited', async () => {
    const u = await prisma.users.findUnique({ where: { id: targetUserId }, select: { id: true, email: true } });
    if (!u) return;
    await sendDirectMessage(u.id, u.email, `🕘 **勤怠が修正されました**\n\n${workDate} の記録を管理者が修正しました。\n\n確認: ${appUrl()}/work`, 'attendance_edited');
  });
}

// Reimbursement merged into the pay statement of `payMonth` -> one DM per claimant
export function notifyExpenseAddedToPayslip(claimIds: string[], payMonth: string) {
  return safely('expense_in_payslip', async () => {
    const claims = await prisma.expense_claims.findMany({
      where: { id: { in: claimIds } },
      select: { amount: true, user: { select: { id: true, email: true } } },
    });
    const byUser = new Map<string, { email: string; count: number; total: number }>();
    for (const c of claims) {
      const e = byUser.get(c.user.id) ?? { email: c.user.email, count: 0, total: 0 };
      e.count++; e.total += c.amount; byUser.set(c.user.id, e);
    }
    const [y, m] = payMonth.split('-');
    await Promise.all([...byUser.entries()].map(([id, e]) => sendDirectMessage(id, e.email,
      `💴 **立替金を${y}年${Number(m)}月分の給与明細に合算しました**\n\n${e.count}件 ・ 合計 **${yen(e.total)}**\n支払日に給与と一緒に支払われます。\n\n明細の確認: ${appUrl()}/work`, 'expense_in_payslip')));
  });
}

const fmtDate = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

// A trip request (or a resubmission) -> admins and the applicant's unit heads (never the applicant)
export function notifyTripSubmitted(tripId: string, resubmitted = false) {
  return safely('trip_submitted', async () => {
    const t = await prisma.business_trips.findUnique({ where: { id: tripId }, include: { user: { select: { id: true, name: true } } } });
    if (!t) return;
    const msg =
      `✈️ **出張申請が${resubmitted ? '再申請されました' : '届きました'}**\n\n` +
      `**${mmText(t.user.name, 40)}** さん ・ ${mmText(t.destination, 60)} ・ ${fmtDate(t.start_date)}〜${fmtDate(t.end_date)}\n` +
      `業務内容: ${mmText(t.purpose, 120)}\n\n承認・却下: ${appUrl()}/approvals`;
    await dmAll(await reviewersOf(t.user_id), msg, 'trip_submitted');
  });
}

// Approved / rejected -> the applicant
export function notifyTripReviewed(tripId: string, action: 'approve' | 'reject') {
  return safely('trip_reviewed', async () => {
    const t = await prisma.business_trips.findUnique({ where: { id: tripId }, include: { user: { select: { id: true, email: true } } } });
    if (!t) return;
    const what = `${mmText(t.destination, 60)}（${fmtDate(t.start_date)}〜${fmtDate(t.end_date)}）`;
    const msg = action === 'approve'
      ? `✅ **出張申請が承認されました**\n\n${what}\n出張中の経費は、経費申請でこの出張を選んで申請してください。\n\n${appUrl()}/trips`
      : `❌ **出張申請が却下されました**\n\n${what}\n理由: ${mmText(t.review_comment || '(なし)', 300)}\n\n修正して再申請: ${appUrl()}/trips`;
    await sendDirectMessage(t.user.id, t.user.email, msg, action === 'approve' ? 'trip_approved' : 'trip_rejected');
  });
}

// ---- bank transfer requests (account details are never put in a DM) ----
export function notifyPaymentSubmitted(requestId: string, resubmitted = false) {
  return safely('payment_submitted', async () => {
    const r = await prisma.payment_requests.findUnique({ where: { id: requestId }, include: { user: { select: { id: true, name: true } }, vendor: { select: { name: true } } } });
    if (!r) return;
    const msg =
      `🏦 **振込申請が${resubmitted ? '再申請されました' : '届きました'}**\n\n` +
      `**${mmText(r.user.name, 40)}** さん ・ ${mmText(r.vendor.name, 60)} 宛 ・ **${yen(r.amount)}**\n` +
      `件名: ${mmText(r.title, 100)} ・ 支払期日 ${r.due_date.toISOString().slice(0, 10)}\n\n承認・却下: ${appUrl()}/payments`;
    await dmAll(await adminsExcept(r.user_id), msg, 'payment_submitted');
  });
}

export function notifyPaymentReviewed(requestId: string, action: 'approve' | 'reject') {
  return safely('payment_reviewed', async () => {
    const r = await prisma.payment_requests.findUnique({ where: { id: requestId }, include: { user: { select: { id: true, email: true } }, vendor: { select: { name: true } } } });
    if (!r) return;
    const label = `${mmText(r.vendor.name, 60)} 宛「${mmText(r.title, 80)}」 ${yen(r.amount)}`;
    const msg = action === 'approve'
      ? `✅ **振込申請が承認されました**\n\n${label}\n支払期日までに振込が行われます。\n\n${appUrl()}/payments`
      : `❌ **振込申請が却下されました**\n\n${label}\n理由: ${mmText(r.review_comment || '(なし)', 300)}\n\n修正して再申請: ${appUrl()}/payments`;
    await sendDirectMessage(r.user.id, r.user.email, msg, action === 'approve' ? 'payment_approved' : 'payment_rejected');
  });
}

// Transferred -> the applicant of each request
export function notifyPaymentPaid(requestIds: string[], paidDate: string) {
  return safely('payment_paid', async () => {
    const rows = await prisma.payment_requests.findMany({
      where: { id: { in: requestIds } },
      select: { title: true, amount: true, user: { select: { id: true, email: true } }, vendor: { select: { name: true } } },
    });
    await Promise.all(rows.map(r => sendDirectMessage(r.user.id, r.user.email,
      `💴 **振込が完了しました**\n\n${mmText(r.vendor.name, 60)} 宛「${mmText(r.title, 80)}」 ${yen(r.amount)}（振込日 ${paidDate}）\n\n${appUrl()}/payments`, 'payment_paid')));
  });
}

// 全銀データができた（経理が「承認して確定」した） -> 振り込まれる人ごとに1通。金額と口座は載せない
export function notifyBatchConfirmed(batchId: string) {
  return safely('batch_confirmed', async () => {
    const [batch, slips, claims, pays] = await Promise.all([
      prisma.transfer_batches.findUnique({ where: { id: batchId }, select: { transfer_date: true } }),
      prisma.payslips.findMany({ where: { batch_id: batchId }, select: { pay_month: true, title: true, user: { select: { id: true, email: true } } } }),
      prisma.expense_claims.findMany({ where: { batch_id: batchId }, select: { user: { select: { id: true, email: true } } } }),
      prisma.payment_requests.findMany({ where: { batch_id: batchId }, select: { title: true, user: { select: { id: true, email: true } }, vendor: { select: { name: true } } } }),
    ]);
    if (!batch) return;
    const people = new Map<string, { email: string; lines: string[]; claims: number }>();
    const of = (u: { id: string; email: string }) => { const p = people.get(u.id) ?? { email: u.email, lines: [], claims: 0 }; people.set(u.id, p); return p; };
    for (const s of slips) of(s.user).lines.push(`${s.pay_month}分 ${mmText(s.title, 40)}`);
    for (const c of claims) of(c.user).claims++;
    for (const r of pays) of(r.user).lines.push(`振込申請「${mmText(r.title, 40)}」（${mmText(r.vendor.name, 30)} 宛）`);
    const date = fmtDate(batch.transfer_date);
    // 1通ずつ順に送る（Mattermost に一斉に投げない）
    for (const [userId, p] of people) {
      const lines = [...p.lines, ...(p.claims > 0 ? [`経費の立替金（${p.claims}件）`] : [])];
      await sendDirectMessage(userId, p.email,
        `🏦 **お振込が確定しました**\n\n振込予定日: ${date}\n${lines.map(l => `・${l}`).join('\n')}\n\n経理の承認が済み、銀行へ渡す振込データができました。振込予定日以降に、口座への入金をご確認ください。\n\n${appUrl()}/notifications`,
        'payment_confirmed');
    }
  });
}

// ---- bank accounts (never include the number) ----
export function notifyBankAccountChanged(userId: string) {
  return safely('bank_changed', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { name: true } });
    if (!u) return;
    const finance = await prisma.users.findMany({ where: { id: { not: userId }, OR: [{ role: 'admin' }, { is_accounting: true }] }, select: { id: true, email: true } });
    await dmAll(finance, `🏦 **受取口座が登録・変更されました**\n\n**${mmText(u.name, 40)}** さんの口座は未確認です。本人の書類と照合して確認済にしてください。\n\n${appUrl()}/transfers`, 'bank_account_changed');
  });
}

/** Finance staff changed (or removed) somebody's account for them: the owner is told, and so are the other finance staff, who have to check it. */
export function notifyBankAccountChangedByStaff(userId: string, actorId: string, removed = false) {
  return safely('bank_changed_by_staff', async () => {
    const [u, actor] = await Promise.all([
      prisma.users.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
      prisma.users.findUnique({ where: { id: actorId }, select: { name: true } }),
    ]);
    if (!u) return;
    const by = mmText(actor?.name ?? '経理担当', 40);
    await sendDirectMessage(u.id, u.email, `🏦 **受取口座が${removed ? '削除' : '変更'}されました**\n\n${by} さんが、あなたの受取口座を${removed ? '削除' : '登録・変更'}しました。覚えがないときは、経理担当に連絡してください。\n\n${appUrl()}/profile#bank`, 'bank_account_changed_by_staff');
    if (removed) return;
    const finance = await prisma.users.findMany({ where: { id: { notIn: [userId, actorId] }, OR: [{ role: 'admin' }, { is_accounting: true }] }, select: { id: true, email: true } });
    await dmAll(finance, `🏦 **受取口座が変更されました**\n\n${by} さんが **${mmText(u.name, 40)}** さんの口座を変更しました。内容を確かめて、確認済にしてください。\n\n${appUrl()}/transfers`, 'bank_account_changed');
  });
}

export function notifyBankAccountVerified(userId: string) {
  return safely('bank_verified', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return;
    await sendDirectMessage(u.id, u.email, `✅ **受取口座が確認されました**\n\n給与などの振込先として使えるようになりました。\n\n${appUrl()}/profile#bank`, 'bank_account_verified');
  });
}

// ---- 人事評価 (scores and grades are never put in a DM) ----
async function hrPeopleExcept(userId: string) {
  return prisma.users.findMany({ where: { id: { not: userId }, OR: [{ role: 'admin' }, { position: { permissions: { has: 'hr_admin' } } }] }, select: { id: true, email: true } });
}

export function notifyEvaluationOpened(cycleId: string) {
  return safely('eval_opened', async () => {
    const c = await prisma.eval_cycles.findUnique({ where: { id: cycleId }, include: { evaluations: { select: { user: { select: { id: true, email: true } } } } } });
    if (!c) return;
    const msg = `📝 **人事評価が始まりました**\n\n「${mmText(c.name, 60)}」の自己評価を入力してください。\n\n${appUrl()}/evaluations`;
    await dmAll(c.evaluations.map(e => e.user), msg, 'eval_opened');
  });
}

export function notifyEvaluationSelfSubmitted(evaluationId: string) {
  return safely('eval_self_submitted', async () => {
    const e = await prisma.evaluations.findUnique({ where: { id: evaluationId }, include: { user: { select: { name: true } }, evaluator: { select: { id: true, email: true } }, cycle: { select: { name: true } } } });
    if (!e?.evaluator) return;
    await sendDirectMessage(e.evaluator.id, e.evaluator.email,
      `📝 **自己評価が提出されました**\n\n**${mmText(e.user.name, 40)}** さん（${mmText(e.cycle.name, 60)}）の評価をお願いします。\n\n${appUrl()}/evaluations`, 'eval_self_submitted');
  });
}

export function notifyEvaluationManagerSubmitted(evaluationId: string) {
  return safely('eval_manager_submitted', async () => {
    const e = await prisma.evaluations.findUnique({ where: { id: evaluationId }, include: { user: { select: { id: true, name: true } }, cycle: { select: { name: true } } } });
    if (!e) return;
    await dmAll(await hrPeopleExcept(e.user.id), `📝 **上長の評価が提出されました**\n\n**${mmText(e.user.name, 40)}** さん（${mmText(e.cycle.name, 60)}）の結果を確認して、確定してください。\n\n${appUrl()}/evaluations`, 'eval_manager_submitted');
  });
}

export function notifyEvaluationFinalized(evaluationId: string) {
  return safely('eval_finalized', async () => {
    const e = await prisma.evaluations.findUnique({ where: { id: evaluationId }, include: { user: { select: { id: true, email: true } }, cycle: { select: { name: true } } } });
    if (!e) return;
    await sendDirectMessage(e.user.id, e.user.email, `📝 **人事評価の結果が公開されました**\n\n「${mmText(e.cycle.name, 60)}」の結果を確認できます。\n\n${appUrl()}/evaluations`, 'eval_finalized');
  });
}

// ---- security notices to the person whose account it is (no passwords or tokens, only where/what) ----
export function notifyNewDeviceLogin(userId: string, o: { place: string; device: string; ip: string; method: string; at: Date }) {
  return safely('new_device_login', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return;
    const when = o.at.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    await sendDirectMessage(u.id, u.email,
      `🔐 **新しい端末からログインがありました**\n\n日時: ${when}\n端末: ${mmText(o.device, 60)}\n場所: ${mmText(o.place, 80)}（${mmText(o.ip, 45)}）\n方法: ${o.method}\n\n` +
      `心当たりがない場合は、すぐにパスワードを変更し、「ログイン中の端末」から該当の端末を終了してください。\n${appUrl()}/profile`, 'security_new_device');
  });
}

export function notifyLoginLockout(userId: string, ip: string) {
  return safely('login_lockout', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return;
    await sendDirectMessage(u.id, u.email,
      `⚠️ **ログインに繰り返し失敗しています**\n\nあなたのアカウントに、${mmText(ip, 45)} から何度もログインが試みられ、一時的に制限しました。ご自身でない場合は、パスワードを変更してください。\n${appUrl()}/profile`, 'security_lockout');
  });
}

export function notifyRecoveryCodeUsed(userId: string, ip: string) {
  return safely('mfa_recovery_used', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return;
    await sendDirectMessage(u.id, u.email, `🔐 **2段階認証の回復コードが使われました**\n\n${mmText(ip, 45)} から、回復コードでログインしました。ご自身でない場合は、すぐにパスワードを変更してください。\n${appUrl()}/profile`, 'security_recovery_used');
  });
}

// what changed about the second factor (never the secret or the codes)
export function notifyMfaChanged(userId: string, what: 'enabled' | 'disabled' | 'reset' | 'codes_regenerated') {
  const text = {
    enabled: '2段階認証が有効になりました。', disabled: '2段階認証が無効になりました。',
    reset: '管理者が、あなたの2段階認証をリセットしました。次回のログインで、あらためて設定してください。', codes_regenerated: '回復コードが再発行されました。古いコードは使えません。',
  }[what];
  return safely('mfa_changed', async () => {
    const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!u) return;
    await sendDirectMessage(u.id, u.email, `🔐 **${text}**\n\n心当たりがない場合は、すぐに管理者に連絡し、パスワードを変更してください。\n${appUrl()}/profile`, `security_mfa_${what}`);
  });
}

// A to-do was given to somebody -> that person (never when they gave it to themselves)
export function notifyTodoAssigned(todoId: string, byUserId: string) {
  return safely('todo_assigned', async () => {
    const t = await prisma.todos.findUnique({
      where: { id: todoId },
      include: { assignee: { select: { id: true, email: true } }, creator: { select: { name: true } }, mailbox: { select: { display_name: true } } },
    });
    if (!t?.assignee || t.assignee.id === byUserId) return;
    const by = await prisma.users.findUnique({ where: { id: byUserId }, select: { name: true } });
    const due = t.due_date ? `\n期限: ${t.due_date.toISOString().slice(0, 10)}` : '';
    const msg = `📝 **ToDoが割り当てられました**\n\n${mmText(t.title, 100)}${due}\n担当に指定した人: ${mmText(by?.name ?? '', 40)} ・ ${mmText(t.mailbox.display_name, 40)}\n\n${appUrl()}/todos`;
    await sendDirectMessage(t.assignee.id, t.assignee.email, msg, 'todo_assigned');
  });
}
