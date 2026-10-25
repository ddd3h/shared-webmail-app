import { z } from 'zod';
import { decrypt, encrypt } from '@/lib/crypto';
import { getSetting, setSetting, type AppSettingKey } from '@/lib/settings';
import { toZenginKana, type ZenginHeader, type CategoryCode } from '@/lib/zengin';

// The company's own (委託者) details that go into the header record of every 全銀 file.
export const zenginSettingsSchema = z.object({
  client_code: z.string().trim().regex(/^\d{10}$/),
  client_name: z.string().trim().min(1).max(40).refine(s => toZenginKana(s) !== null, 'kana'),
  bank_code: z.string().trim().regex(/^\d{4}$/),
  bank_name: z.string().trim().min(1).max(30),
  branch_code: z.string().trim().regex(/^\d{3}$/),
  branch_name: z.string().trim().min(1).max(30),
  account_type: z.enum(['ordinary', 'checking', 'savings']),
  account_number: z.string().trim().regex(/^\d{1,7}$/),
});
export type ZenginSettings = z.infer<typeof zenginSettingsSchema>;

const KEYS: Record<keyof ZenginSettings, AppSettingKey> = {
  client_code: 'ZENGIN_CLIENT_CODE', client_name: 'ZENGIN_CLIENT_NAME', bank_code: 'ZENGIN_BANK_CODE', bank_name: 'ZENGIN_BANK_NAME',
  branch_code: 'ZENGIN_BRANCH_CODE', branch_name: 'ZENGIN_BRANCH_NAME', account_type: 'ZENGIN_ACCOUNT_TYPE', account_number: 'ZENGIN_ACCOUNT_NUMBER',
};
const SECRET = new Set<keyof ZenginSettings>(['client_code', 'account_number']);

export async function loadZenginSettings(): Promise<Partial<ZenginSettings>> {
  const out: Record<string, string> = {};
  for (const [field, key] of Object.entries(KEYS)) {
    const raw = await getSetting(key);
    if (!raw) continue;
    // the client code and the company's account number are stored encrypted
    const v = SECRET.has(field as keyof ZenginSettings) ? await decrypt(raw).catch(() => '') : raw;
    if (v) out[field] = v;
  }
  return out as Partial<ZenginSettings>;
}

export async function saveZenginSettings(s: ZenginSettings, userId: string) {
  const padded = { ...s, account_number: s.account_number.padStart(7, '0') };
  for (const [field, key] of Object.entries(KEYS) as [keyof ZenginSettings, AppSettingKey][]) {
    await setSetting(key, SECRET.has(field) ? await encrypt(padded[field]) : padded[field], SECRET.has(field), userId);
  }
}

export function toHeader(s: Partial<ZenginSettings>, category: CategoryCode, transferDate: string): ZenginHeader {
  return {
    categoryCode: category, clientCode: s.client_code ?? '', clientName: s.client_name ?? '', transferDate,
    bankCode: s.bank_code ?? '', bankName: s.bank_name ?? '', branchCode: s.branch_code ?? '', branchName: s.branch_name ?? '',
    accountType: s.account_type ?? 'ordinary', accountNumber: s.account_number ?? '',
  };
}
