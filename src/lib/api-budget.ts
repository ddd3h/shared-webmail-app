// How many requests a signed-in person may make per minute, by kind of endpoint. Real use stays far below these;
// a script copying a whole list (bank accounts, receipts, exports, ...) does not.
export type Budget = { group: string; perMinute: number };

const RULES: { prefix: string; budget: Budget }[] = [
  { prefix: '/api/payments/export', budget: { group: 'export', perMinute: 10 } },
  { prefix: '/api/bank-accounts', budget: { group: 'bank-accounts', perMinute: 60 } },
  { prefix: '/api/zengin', budget: { group: 'zengin', perMinute: 60 } },
  { prefix: '/api/transfers', budget: { group: 'transfers', perMinute: 120 } },
  { prefix: '/api/payments/documents', budget: { group: 'downloads', perMinute: 120 } },
  { prefix: '/api/expenses/receipts', budget: { group: 'downloads', perMinute: 120 } },
  { prefix: '/api/admin', budget: { group: 'admin', perMinute: 300 } },
];
const DEFAULT: Budget = { group: 'api', perMinute: 900 };

export function budgetFor(pathname: string): Budget {
  return RULES.find(r => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))?.budget ?? DEFAULT;
}

/** A path segment that looks like a record id (cuid / uuid): `/api/evaluations/cm2x...` */
const ID_SEGMENT = /\/(c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,})(\/|$)/i;
export const isRecordPath = (pathname: string) => ID_SEGMENT.test(pathname);
