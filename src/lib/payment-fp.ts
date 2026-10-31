// A fingerprint of the bank details of a payee. An approval is of the details as they were then: it is kept with the request, and paying
// to details that have changed since (a swapped account) is refused until an admin confirms the new ones. Server side only.
import { createHash } from 'crypto';

type Details = { bank_code: string | null; branch_code: string | null; account_type: string; account_number_enc: string; account_last4: string; account_holder: string };

/** The same text, hashed the same way, as the SQL of the migration that filled it in for requests approved before. */
export const vendorFingerprint = (v: Details) =>
  createHash('sha256').update([v.bank_code ?? '', v.branch_code ?? '', v.account_type, v.account_number_enc, v.account_last4, v.account_holder].join('|'), 'utf8').digest('hex');

/** True when the request was approved against bank details that are no longer the payee's. (No fingerprint = approved before this existed: not blocked.) */
export const accountChangedSinceApproval = (r: { approved_account_fp: string | null }, v: Details) => !!r.approved_account_fp && r.approved_account_fp !== vendorFingerprint(v);

export const ACCOUNT_CHANGED_REASON = '承認のあとに振込先の口座が変更されています（管理者が、新しい口座を確認し直すまで振り込めません）';
