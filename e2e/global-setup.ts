import { mkdirSync } from 'fs';
import { request } from '@playwright/test';
import { startMattermostMock } from './helpers/mattermost-mock';
import { seedBase } from './helpers/seed';
import { db } from './helpers/db';
import { AUTH, BASE_URL, PASSWORD, ROLES, USERS } from './helpers/constants';

// Pages and API routes are compiled on first hit by `next dev`; touching them once up front keeps the specs fast and stable.
const WARM_PAGES = ['/calendar', '/work', '/expenses', '/trips', '/payments', '/contacts', '/notifications', '/scheduled', '/profile', '/threads', '/admin/settings'];
const WARM_APIS = [
  '/api/work/me', '/api/work/settings', '/api/work/users', '/api/work/attendance', '/api/work/reports', '/api/work/payslips',
  '/api/expenses', '/api/trips', '/api/trips/allowance-types', '/api/payments', '/api/payments/vendors', '/api/payments/export',
  '/api/calendar/events?mailboxId=mb_team&from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z', '/api/mailboxes?mine=1', '/api/auth/session',
];

export default async function globalSetup() {
  const stopMock = await startMattermostMock();
  await seedBase();
  // The saved sessions are shared by the desktop and the phone project (different browsers), so the "cookie only works on the device it was issued to" check is off by default; e2e/security.spec.ts turns it on for its own tests.
  await db.app_settings.upsert({ where: { key: 'SECURITY_DEVICE_BINDING' }, create: { key: 'SECURITY_DEVICE_BINDING', value: 'off' }, update: { value: 'off' } });

  mkdirSync('e2e/.auth', { recursive: true });
  let n = 1;
  for (const role of ROLES) {
    // each login gets its own fake client IP so the per-IP login limiter never trips
    const ctx = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { 'x-forwarded-for': `10.9.0.${n++}` } });
    const res = await ctx.post('/api/auth/login', { data: { email: USERS[role].email, password: PASSWORD } });
    if (!res.ok()) throw new Error(`E2E login failed for ${role}: ${res.status()} ${await res.text()}`);
    await ctx.storageState({ path: AUTH[role] });
    await ctx.dispose();
  }

  const warm = await request.newContext({ baseURL: BASE_URL, storageState: AUTH.admin });
  await Promise.all([...WARM_PAGES, ...WARM_APIS].map(p => warm.get(p, { timeout: 120_000 }).catch(() => {})));
  await warm.dispose();

  return async () => {
    await stopMock();
    await db.$disconnect();
  };
}
