// Mattermost DMs for the expense / work-report / payslip / attendance features.
// Every function swallows its own errors so callers can fire and forget.
import { prisma } from '@/lib/db';
import { mmText, sendDirectMessage } from '@/lib/mattermost-dm';
import { PAYMENT_LABEL, type PaymentMethod } from '@/lib/expense';

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

async function safely(label: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { console.error(`[work-notify] ${label} failed:`, e); }
}

async function adminsExcept(userId: string) {
  return prisma.users.findMany({ where: { role: 'admin', id: { not: userId } }, select: { id: true, email: true } });
}

async function dmAll(users: { id: string; email: string }[], message: string, type: string) {
  await Promise.all(users.map(u => sendDirectMessage(u.id, u.email, message, type)));
}

// A new (or resubmitted) claim -> every admin except the claimant
export function notifyExpenseSubmitted(claimId: string, resubmitted = false) {
  return safely('expense_submitted', async () => {
    const c = await prisma.expense_claims.findUnique({ where: { id: claimId }, include: { user: { select: { id: true, name: true } } } });
    if (!c) return;
    const msg =
      `🧾 **経費申請が${resubmitted ? '再申請されました' : '届きました'}**\n\n` +
      `**${mmText(c.user.name, 40)}** さん ・ **${yen(c.amount)}** ・ ${mmText(c.category, 20)}（${PAYMENT_LABEL[c.payment_method as PaymentMethod]}）\n` +
      `件名: ${mmText(c.title, 100)}\n\n` +
      `承認・却下: ${appUrl()}/expenses`;
    await dmAll(await adminsExcept(c.user_id), msg, 'expense_submitted');
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
    const msg = `📝 **業務報告書が提出されました**\n\n**${mmText(r.user.name, 40)}** さん ・ ${mmText(r.title, 100)}${hours}\n\n確認: ${appUrl()}/work`;
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

// A trip request (or a resubmission) -> every admin except the applicant
export function notifyTripSubmitted(tripId: string, resubmitted = false) {
  return safely('trip_submitted', async () => {
    const t = await prisma.business_trips.findUnique({ where: { id: tripId }, include: { user: { select: { id: true, name: true } } } });
    if (!t) return;
    const msg =
      `✈️ **出張申請が${resubmitted ? '再申請されました' : '届きました'}**\n\n` +
      `**${mmText(t.user.name, 40)}** さん ・ ${mmText(t.destination, 60)} ・ ${fmtDate(t.start_date)}〜${fmtDate(t.end_date)}\n` +
      `業務内容: ${mmText(t.purpose, 120)}\n\n承認・却下: ${appUrl()}/trips`;
    await dmAll(await adminsExcept(t.user_id), msg, 'trip_submitted');
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
