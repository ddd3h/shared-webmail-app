import { z } from 'zod';
import { decrypt } from '@/lib/crypto';
import { maskAccount, type AccountType } from '@/lib/payment';
import { toZenginKana } from '@/lib/zengin';

// A person's own bank account. The holder name goes into the file as-is, so it has to be convertible to 全銀 characters;
// bank / branch names are informational (banks go by the codes) and may stay in kanji.
export const bankAccountSchema = z.object({
  bank_name: z.string().trim().min(1).max(60),
  bank_code: z.string().trim().regex(/^\d{4}$/),
  branch_name: z.string().trim().min(1).max(60),
  branch_code: z.string().trim().regex(/^\d{3}$/),
  account_type: z.enum(['ordinary', 'checking', 'savings']),
  account_number: z.string().trim().regex(/^\d{4,7}$/),
  account_holder: z.string().trim().min(1).max(100).refine(s => toZenginKana(s) !== null, 'kana'),
});

type Row = {
  user_id: string; bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: string;
  account_number_enc: string; account_last4: string; account_holder: string; verified_at: Date | null;
};

// `full` = include the account number (the owner and finance staff only).
export async function serializeBankAccount(r: Row | null, full: boolean) {
  if (!r) return null;
  const base = {
    user_id: r.user_id, bank_name: r.bank_name, bank_code: r.bank_code, branch_name: r.branch_name, branch_code: r.branch_code,
    account_type: r.account_type as AccountType, account_masked: maskAccount(r.account_last4), account_holder: r.account_holder,
    verified: !!r.verified_at, verified_at: r.verified_at,
  };
  if (!full) return base;
  let account_number = '';
  try { account_number = await decrypt(r.account_number_enc); } catch { /* unreadable: show nothing rather than fail the page */ }
  return { ...base, account_number };
}
