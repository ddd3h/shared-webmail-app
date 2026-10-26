'use client';
import { dateLabel, yen } from '@/components/work/ui';
import { ACCOUNT_TYPE_LABEL, FEE_BEARER_LABEL, STATUS_LABEL, transferAmount, type AccountType, type FeeBearer, type PaymentStatus } from '@/lib/payment';

export type Vendor = {
  id: string; name: string; name_kana: string | null; bank_name: string; branch_name: string; account_type: AccountType;
  account_masked: string; is_active: boolean; verified: boolean;
  // admins only
  bank_code?: string | null; branch_code?: string | null; account_number?: string; account_holder?: string; notes?: string | null;
};
export type Doc = { id: string; filename: string; content_type: string; size: number };
export type Request = {
  id: string; user: { id: string; name: string }; vendor: Vendor; title: string; amount: number; deduction_amount: number; fee: number;
  fee_bearer: FeeBearer; transfer_amount: number; invoice_number: string | null; invoice_date: string | null; due_date: string;
  description: string | null; status: PaymentStatus; reviewer: string | null; review_comment: string | null; paid_at: string | null; paid_note: string | null; documents: Doc[];
};
export type Summary = { pending: { count: number; amount: number }; approved: { count: number; amount: number }; paid: { count: number; amount: number }; overdue: number };

export const todayJst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const STYLE: Record<PaymentStatus, string> = { pending: 'bg-amber-100 text-amber-700', approved: 'bg-blue-100 text-blue-700', rejected: 'bg-red-100 text-red-600', paid: 'bg-emerald-100 text-emerald-700' };
export const StatusBadge = ({ s }: { s: PaymentStatus }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${STYLE[s]}`}>{STATUS_LABEL[s]}</span>;

export const VerifiedBadge = ({ v }: { v: Pick<Vendor, 'verified'> }) =>
  v.verified
    ? <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">口座確認済</span>
    : <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">口座未確認</span>;

export function RequestHeader({ r, showUser }: { r: Request; showUser?: boolean }) {
  const overdue = r.status === 'approved' && r.due_date < todayJst();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>期日 {dateLabel(r.due_date)}</span>
          {overdue && <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-red-600">期日超過</span>}
          {showUser && <span className="rounded-sm bg-gray-100 px-1.5 py-0.5 text-gray-700">{r.user.name}</span>}
        </div>
        <div className="mt-0.5 text-sm font-medium text-gray-900 wrap-break-word">{r.vendor.name} <span className="text-gray-400 font-normal">宛</span> {r.title}</div>
      </div>
      <StatusBadge s={r.status} />
      <div className="text-right"><div className="text-[10px] text-gray-400">振込額</div><div className="text-base font-bold tabular-nums">{yen(r.transfer_amount)}</div></div>
    </div>
  );
}

export function Breakdown({ r }: { r: Pick<Request, 'amount' | 'deduction_amount' | 'fee' | 'fee_bearer'> }) {
  const Row = ({ l, v, minus }: { l: string; v: number; minus?: boolean }) => (
    <div className="flex justify-between px-3 py-1.5 border-b border-gray-100 last:border-0"><span>{l}</span><span className="tabular-nums">{minus ? '−' : ''}{yen(v)}</span></div>
  );
  return (
    <div className="rounded-lg border border-gray-100 text-sm">
      <Row l="請求金額" v={r.amount} />
      {r.deduction_amount > 0 && <Row l="控除（源泉所得税など）" v={r.deduction_amount} minus />}
      {r.fee_bearer === 'vendor' && r.fee > 0 && <Row l="振込手数料（先方負担）" v={r.fee} minus />}
      <div className="flex justify-between bg-gray-50 px-3 py-1.5 font-bold"><span>振込額</span><span className="tabular-nums">{yen(transferAmount(r))}</span></div>
      {r.fee_bearer === 'us' && r.fee > 0 && <div className="px-3 py-1 text-[11px] text-gray-400">振込手数料 {yen(r.fee)} は当方負担（別途かかります）</div>}
    </div>
  );
}

export function AccountInfo({ v }: { v: Vendor }) {
  const full = v.account_number !== undefined;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-700 space-y-0.5">
      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-gray-900">{v.name}</span><VerifiedBadge v={v} /></div>
      <div>{v.bank_name}{full && v.bank_code ? `（${v.bank_code}）` : ''} / {v.branch_name}{full && v.branch_code ? `（${v.branch_code}）` : ''}</div>
      <div>{ACCOUNT_TYPE_LABEL[v.account_type]} {full ? <span className="font-mono tabular-nums">{v.account_number}</span> : v.account_masked}</div>
      {full && <div>名義: {v.account_holder}</div>}
    </div>
  );
}

export function DocLinks({ docs }: { docs: Doc[] }) {
  if (docs.length === 0) return <span className="text-xs text-gray-400">請求書の添付なし</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {docs.map(d => (
        <a key={d.id} href={`/api/payments/documents/${d.id}`} download className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50">📎 {d.filename.length > 24 ? `${d.filename.slice(0, 21)}…` : d.filename}</a>
      ))}
    </div>
  );
}

export function RequestDetail({ r }: { r: Request }) {
  return (
    <div className="space-y-3 text-sm">
      <AccountInfo v={r.vendor} />
      <Breakdown r={r} />
      {(r.invoice_number || r.invoice_date) && <p className="text-xs text-gray-500">請求書: {r.invoice_number ?? '番号なし'}{r.invoice_date ? `（${r.invoice_date}）` : ''}</p>}
      {r.fee_bearer && <p className="text-[11px] text-gray-400">振込手数料: {FEE_BEARER_LABEL[r.fee_bearer]}</p>}
      {r.description && <p className="whitespace-pre-wrap wrap-break-word text-gray-700">{r.description}</p>}
      <DocLinks docs={r.documents} />
      {r.review_comment && (
        <p className={`rounded-lg px-3 py-2 text-xs ${r.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>{r.reviewer ?? '管理者'} のコメント: {r.review_comment}</p>
      )}
      {r.status === 'paid' && <p className="text-xs text-emerald-700">{r.paid_at} に振込済み{r.paid_note ? `（${r.paid_note}）` : ''}</p>}
    </div>
  );
}
