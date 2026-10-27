// DB side of a receiving account: shared by the owner's own route and the finance staff's route.
import { decrypt, encrypt } from '@/lib/crypto';
import { last4 } from '@/lib/payment';
import type { bankAccountSchema } from '@/lib/bank-account';

export type Input = ReturnType<typeof bankAccountSchema.parse>;
type Saved = { bank_name: string; bank_code: string; branch_name: string; branch_code: string; account_type: string; account_holder: string; account_number_enc: string; verified_at: Date | null };

/** True when anything that decides where money goes differs from what is stored. */
export async function accountChanged(existing: Saved | null, d: Input): Promise<boolean> {
  if (!existing) return true;
  const sameFields =
    existing.bank_name === d.bank_name && existing.bank_code === d.bank_code && existing.branch_name === d.branch_name &&
    existing.branch_code === d.branch_code && existing.account_type === d.account_type && existing.account_holder === d.account_holder;
  return !sameFields || (await decrypt(existing.account_number_enc).catch(() => '')) !== d.account_number;
}

export async function rowData(d: Input, changed: boolean, existing: Saved | null, changedById: string | null = null) {
  return {
    bank_name: d.bank_name, bank_code: d.bank_code, branch_name: d.branch_name, branch_code: d.branch_code, account_type: d.account_type,
    account_number_enc: changed ? await encrypt(d.account_number) : existing!.account_number_enc, account_last4: last4(d.account_number),
    account_holder: d.account_holder,
    // any change must be checked by finance again before money is sent to it
    ...(changed ? { verified_at: null, verified_by_id: null, changed_by_id: changedById } : {}),
  };
}

