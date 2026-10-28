// A record of security-relevant happenings for the admin's security page. Best effort: never breaks the request.
import { prisma } from '@/lib/db';

export type Severity = 'info' | 'warn' | 'alert';
export type SecurityEvent = { type: string; severity?: Severity; ip?: string | null; userId?: string | null; email?: string | null; detail?: Record<string, unknown> };

export async function recordSecurityEvent(e: SecurityEvent): Promise<void> {
  try {
    await prisma.security_events.create({
      data: { type: e.type, severity: e.severity ?? 'info', ip: e.ip ?? null, user_id: e.userId ?? null, email: e.email ?? null, detail: e.detail ? JSON.stringify(e.detail) : null },
    });
  } catch (err) {
    console.error('[security-events] failed to record', e.type, err);
  }
}
