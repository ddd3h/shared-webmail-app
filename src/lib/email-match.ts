// Prisma turns `mode: 'insensitive'` into ILIKE, so a % or _ typed by the caller acts as a wildcard
// ("%" would match every user). Escape them, and let callers re-check the hit in JS (`sameEmail`).
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`);
export const sameEmail = (a: string | null | undefined, b: string) => !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
export const emailEquals = (email: string) => ({ equals: escapeLike(email), mode: 'insensitive' as const });
