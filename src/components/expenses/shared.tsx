'use client';
import { dateLabel, yen } from '@/components/work/ui';

export type Receipt = { id: string; filename: string; content_type: string; size: number };
export type Claim = {
  id: string; user: { id: string; name: string }; expense_date: string; category: string; title: string; amount: number;
  payment_method: 'personal' | 'company'; description: string | null; status: 'pending' | 'approved' | 'rejected' | 'paid';
  reviewer: string | null; review_comment: string | null; reimbursed_at: string | null; reimburse_note: string | null; receipts: Receipt[];
  payslip: { id: string; pay_month: string; title: string; status: string } | null;
  trip: { id: string; destination: string; start_date: string; end_date: string } | null;
};
type Sum = { count: number; amount: number };
export type Summary = { pending: Sum; to_reimburse: Sum; in_payslip: Sum; paid: Sum };

export const CATEGORIES = ['交通費', '出張・宿泊費', '交際費', '会議費', '消耗品費', '通信費', '書籍・研修費', 'その他'];
export const STATUS_LABEL = { pending: '承認待ち', approved: '承認済', rejected: '却下', paid: '返金済' } as const;
const STATUS_STYLE = {
  pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-600', paid: 'bg-emerald-100 text-emerald-700',
} as const;

export function StatusBadge({ c }: { c: Claim }) {
  // An approved company-paid claim has nothing left to do, so say so instead of "承認済".
  const owed = c.status === 'approved' && c.payment_method === 'personal';
  const label = owed ? (c.payslip ? '給与に合算済' : '返金待ち') : STATUS_LABEL[c.status];
  const style = owed && c.payslip ? 'bg-violet-100 text-violet-700' : STATUS_STYLE[c.status];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${style}`}>{label}</span>;
}

export function PaymentBadge({ m }: { m: Claim['payment_method'] }) {
  return <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${m === 'personal' ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-600'}`}>{m === 'personal' ? '立替' : '会社負担'}</span>;
}

export function ReceiptLinks({ receipts }: { receipts: Receipt[] }) {
  if (receipts.length === 0) return <span className="text-xs text-gray-400">領収書なし</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {receipts.map(r => (
        <a key={r.id} href={`/api/expenses/receipts/${r.id}`} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50" download>
          📎 {r.filename.length > 24 ? `${r.filename.slice(0, 21)}…` : r.filename}
        </a>
      ))}
    </div>
  );
}

export function ClaimDetail({ c }: { c: Claim }) {
  return (
    <div className="space-y-2 text-sm">
      {c.trip && <p className="text-xs text-sky-700">出張: {c.trip.destination}（{c.trip.start_date.slice(5).replace('-', '/')}〜{c.trip.end_date.slice(5).replace('-', '/')}）</p>}
      {c.description && <p className="whitespace-pre-wrap wrap-break-word text-gray-700">{c.description}</p>}
      <ReceiptLinks receipts={c.receipts} />
      {c.review_comment && (
        <p className={`rounded-lg px-3 py-2 text-xs ${c.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
          {c.reviewer ?? '管理者'} のコメント: {c.review_comment}
        </p>
      )}
      {c.status === 'approved' && c.payslip && (
        <p className="text-xs text-violet-700">{Number(c.payslip.pay_month.slice(5))}月分の{c.payslip.title}に合算されています。明細が支払済になると、返金済になります。</p>
      )}
      {c.status === 'paid' && <p className="text-xs text-emerald-700">{c.reimbursed_at} に返金済み{c.reimburse_note ? `（${c.reimburse_note}）` : ''}</p>}
    </div>
  );
}

export function ClaimHeader({ c, showUser }: { c: Claim; showUser?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>{dateLabel(c.expense_date)}</span><span>{c.category}</span>{showUser && <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-gray-700">{c.user.name}</span>}
          <PaymentBadge m={c.payment_method} />
          {c.trip && <span className="rounded-sm bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-700">✈ {c.trip.destination}</span>}
        </div>
        <div className="mt-0.5 text-sm font-medium text-gray-900 wrap-break-word">{c.title}</div>
      </div>
      <StatusBadge c={c} />
      <div className="text-right text-base font-bold tabular-nums">{yen(c.amount)}</div>
    </div>
  );
}
