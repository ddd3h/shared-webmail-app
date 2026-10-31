// Who may call the /api/cron/* addresses (they are outside the login: the proxy lets them through). Only a caller that knows the secret.
import { timingSafeEqual } from 'crypto';

/** True when the request carries `Authorization: Bearer <CRON_SECRET>`. With no secret set, nobody gets in (a missing secret must never read as "Bearer undefined"). */
export function cronAuthorized(req: { headers: { get(name: string): string | null } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.headers.get('authorization') ?? '';
  const a = Buffer.from(given), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
