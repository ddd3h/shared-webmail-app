import { request } from '@playwright/test';
import { AUTH, BASE_URL, PASSWORD, ROLES, USERS } from './constants';

/**
 * Log the saved test users in again (the files in e2e/.auth that most specs open their pages with).
 * A spec that ends the sessions of those people on purpose (a lock, "log out everywhere", a password change) calls this when it is done:
 * the server now checks that a session is still alive on every request, so a saved login that was ended is a login that is gone.
 */
export async function refreshSavedLogins() {
  for (const role of ROLES) {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const res = await ctx.post('/api/auth/login', { data: { email: USERS[role].email, password: PASSWORD } });
    if (res.ok()) await ctx.storageState({ path: AUTH[role] });
    await ctx.dispose();
  }
}
