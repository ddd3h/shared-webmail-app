// freee accounting API (https://developer.freee.co.jp/): OAuth connection and the few calls this app needs.
// FREEE_AUTH_URL / FREEE_API_URL replace the addresses of the service (the tests use a stand-in).
// Tokens are kept encrypted in app_settings (the access token lasts about a day; the refresh token is used once and replaced by a new one).
import { z } from 'zod';
import { decrypt, encrypt } from '@/lib/crypto';
import { getSetting, setSetting, type AppSettingKey } from '@/lib/settings';
import { prisma } from '@/lib/db';
import { EXPENSE_CATEGORIES } from '@/lib/expense';

export const freeeAuthUrl = () => (process.env.FREEE_AUTH_URL?.trim() || 'https://accounts.secure.freee.co.jp').replace(/\/+$/, '');
export const freeeApiUrl = () => (process.env.FREEE_API_URL?.trim() || 'https://api.freee.co.jp').replace(/\/+$/, '');
export const freeeRedirectUri = () => `${(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')}/api/freee/callback`;

const TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 60_000; // a receipt is a file of up to 10 MB

// ---- what money is booked as ----

/** The kinds of money movement, and what each is called when asking which freee account (勘定科目) it goes to. */
export const MAP_KINDS = {
  salary: '給与（正社員・パート・派遣・従業員）',
  executive: '役員報酬',
  contractor: '業務委託費・準業務委託費（外注費）',
  payment: '振込申請（取引先への支払）',
  expense: '経費の立替金（科目ごとの指定がないとき）',
} as const;
export type MapKind = keyof typeof MAP_KINDS;
export const mapKeys = (): string[] => [...Object.keys(MAP_KINDS), ...EXPENSE_CATEGORIES.map(c => `expense:${c}`)];

const entry = z.object({ account_item_id: z.number().int().positive(), tax_code: z.number().int().min(0).max(9999).default(0) });
export const accountMapSchema = z.record(z.string(), entry).refine(m => Object.keys(m).every(k => mapKeys().includes(k)), { message: 'unknown_key' });
export type AccountMap = z.infer<typeof accountMapSchema>;

export type Walletable = { id: number; type: 'bank_account' | 'credit_card' | 'wallet'; name?: string };

export type FreeeConfig = {
  clientId: string | null; hasSecret: boolean; connected: boolean;
  companyId: number | null; companyName: string | null; walletable: Walletable | null; map: AccountMap;
  autoSync: boolean; syncFrom: string | null;
  /** Send the 証憑 (receipts, invoices) with each deal. On unless the administrator turned it off. */
  sendReceipts: boolean;
};

const num = (s: string | null) => { const n = Number(s); return s && Number.isInteger(n) && n > 0 ? n : null; };
const parse = <T,>(s: string | null, fallback: T): T => { try { return s ? JSON.parse(s) as T : fallback; } catch { return fallback; } };

export async function loadFreeeConfig(): Promise<FreeeConfig> {
  const [clientId, secret, refresh, companyId, companyName, walletable, map, auto, from, sendReceipts] = await Promise.all(
    (['FREEE_CLIENT_ID', 'FREEE_CLIENT_SECRET', 'FREEE_REFRESH_TOKEN', 'FREEE_COMPANY_ID', 'FREEE_COMPANY_NAME', 'FREEE_WALLETABLE', 'FREEE_ACCOUNT_MAP', 'FREEE_AUTO_SYNC', 'FREEE_SYNC_FROM', 'FREEE_SEND_RECEIPTS'] as AppSettingKey[]).map(k => getSetting(k)),
  );
  const parsedMap = accountMapSchema.safeParse(parse(map, {}));
  return {
    clientId: clientId?.trim() || null, hasSecret: !!secret, connected: !!refresh,
    companyId: num(companyId), companyName: companyName || null, walletable: parse<Walletable | null>(walletable, null),
    map: parsedMap.success ? parsedMap.data : {}, sendReceipts: sendReceipts !== 'off', autoSync: auto === 'on', syncFrom: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null,
  };
}

/** Ready to send: connected, with the company, the bank account the money left from, and the sync start day chosen. */
export const freeeReady = (c: FreeeConfig) => c.connected && c.companyId !== null && c.walletable !== null && c.syncFrom !== null;

// ---- tokens ----

type Tokens = { access_token: string; refresh_token: string; expires_in?: number; company_id?: number };

async function saveTokens(t: Tokens) {
  await setSetting('FREEE_ACCESS_TOKEN', await encrypt(t.access_token), true);
  await setSetting('FREEE_REFRESH_TOKEN', await encrypt(t.refresh_token), true);
  await setSetting('FREEE_TOKEN_EXPIRES_AT', String(Date.now() + ((t.expires_in ?? 86400) - 120) * 1000), false);
}

async function tokenRequest(params: Record<string, string>): Promise<Tokens | null> {
  const [id, secret] = await Promise.all([getSetting('FREEE_CLIENT_ID'), getSetting('FREEE_CLIENT_SECRET')]);
  if (!id || !secret) return null;
  const secretPlain = await decrypt(secret).catch(() => secret); // stored encrypted; a value typed into .env is plain
  const res = await fetch(`${freeeAuthUrl()}/public_api/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secretPlain, ...params }), signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res || !res.ok) { console.error('[freee] token request failed:', res?.status); return null; }
  const j = await res.json().catch(() => null) as Tokens | null;
  return j?.access_token && j.refresh_token ? j : null;
}

/** The code from the authorization screen -> tokens (stored). */
export async function connectWithCode(code: string): Promise<{ ok: boolean; companyId?: number }> {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: freeeRedirectUri() });
  if (!t) return { ok: false };
  await saveTokens(t);
  return { ok: true, companyId: t.company_id };
}

export async function disconnectFreee() {
  await prisma.app_settings.deleteMany({ where: { key: { in: ['FREEE_ACCESS_TOKEN', 'FREEE_REFRESH_TOKEN', 'FREEE_TOKEN_EXPIRES_AT', 'FREEE_COMPANY_ID', 'FREEE_COMPANY_NAME', 'FREEE_WALLETABLE', 'FREEE_AUTO_SYNC'] } } });
}

// One refresh at a time: the refresh token works once, so two callers refreshing together would lose the connection.
let refreshing: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  refreshing ??= (async () => {
    try {
      const enc = await getSetting('FREEE_REFRESH_TOKEN');
      if (!enc) return null;
      const refresh = await decrypt(enc).catch(() => null);
      if (!refresh) return null;
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
      if (!t) return null;
      await saveTokens(t);
      return t.access_token;
    } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

async function accessToken(): Promise<string | null> {
  const [enc, exp] = await Promise.all([getSetting('FREEE_ACCESS_TOKEN'), getSetting('FREEE_TOKEN_EXPIRES_AT')]);
  if (enc && Number(exp) > Date.now()) return decrypt(enc).catch(() => null);
  return refreshAccessToken();
}

// ---- API calls ----

export type FreeeResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, retried = false): Promise<FreeeResult<T>> {
  const form = body instanceof FormData;
  const token = await accessToken();
  if (!token) return { ok: false, status: 401, message: 'freeeに接続されていません（接続し直してください）' };
  const res = await fetch(`${freeeApiUrl()}${path}`, {
    // a file upload is multipart: fetch sets the Content-Type (with the boundary) itself
    method, headers: { Authorization: `Bearer ${token}`, ...(form ? {} : { 'Content-Type': 'application/json' }), 'X-Api-Version': '2020-06-15' },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(form ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, message: 'freeeに接続できませんでした' };
  if (res.status === 401 && !retried) { // the token was revoked or expired early: get a new one once
    await setSetting('FREEE_TOKEN_EXPIRES_AT', '0', false);
    return call<T>(method, path, body, true);
  }
  const json = await res.json().catch(() => null) as { message?: string; errors?: { messages?: string[] }[]; error_description?: string } | null;
  if (!res.ok) {
    const detail = json?.errors?.flatMap(e => e.messages ?? []).join(' / ') || json?.message || json?.error_description || `HTTP ${res.status}`;
    return { ok: false, status: res.status, message: String(detail).slice(0, 500) };
  }
  return { ok: true, data: json as T };
}

export const listCompanies = () => call<{ companies: { id: number; name: string; display_name?: string }[] }>('GET', '/api/1/companies');
export const listWalletables = (companyId: number) => call<{ walletables: { id: number; name: string; type: string }[] }>('GET', `/api/1/walletables?company_id=${companyId}`);
export const listAccountItems = (companyId: number) => call<{ account_items: { id: number; name: string; shortcut?: string }[] }>('GET', `/api/1/account_items?company_id=${companyId}`);

export type DealInput = {
  companyId: number; date: string; walletable: Walletable; receiptIds?: number[];
  details: { account_item_id: number; tax_code: number; amount: number; description: string }[];
};
/** An expense deal that was paid from the bank account on `date`: the freee way of recording "this money left the account". */
export function createDeal(d: DealInput) {
  const total = d.details.reduce((s, x) => s + x.amount, 0);
  return call<{ deal: { id: number } }>('POST', '/api/1/deals', {
    company_id: d.companyId, issue_date: d.date, type: 'expense', details: d.details,
    ...(d.receiptIds?.length ? { receipt_ids: d.receiptIds } : {}),   // 証憑 uploaded before: they are attached to the deal
    payments: [{ date: d.date, from_walletable_type: d.walletable.type, from_walletable_id: d.walletable.id, amount: total }],
  });
}

/** A 証憑 (receipt, invoice) put into freee's ファイルボックス. It is attached to a deal by its id (see DealInput.receiptIds). */
export function uploadReceipt(r: { companyId: number; filename: string; contentType: string; bytes: Buffer; description: string; date: string }) {
  const fd = new FormData();
  fd.append('company_id', String(r.companyId));
  fd.append('receipt', new Blob([new Uint8Array(r.bytes)], { type: r.contentType }), r.filename);
  fd.append('description', r.description.slice(0, 250));
  fd.append('issue_date', r.date);
  return call<{ receipt: { id: number } }>('POST', '/api/1/receipts', fd);
}
