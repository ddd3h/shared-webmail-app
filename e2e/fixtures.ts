import { test as base, expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { AUTH, BASE_URL, type Role } from './helpers/constants';

type Fixtures = {
  // An authenticated API client for the given role (shares the cookie jar format of the UI sessions).
  as: (role: Role) => Promise<APIRequestContext>;
  // An API client with no session.
  anon: APIRequestContext;
};

// `next dev` draws a round "N" badge in the bottom-left corner that swallows clicks on the mobile tab bar.
// It does not exist in production builds, so the tests simply hide it.
export const hideDevOverlay = () => {
  const style = document.createElement('style');
  style.textContent = 'nextjs-portal{display:none!important}';
  const add = () => document.head.appendChild(style);
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);
};

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await context.addInitScript(hideDevOverlay);
    await use(context);
  },
  as: async ({}, use) => {
    const made: APIRequestContext[] = [];
    await use(async role => {
      const ctx = await pwRequest.newContext({ baseURL: BASE_URL, storageState: AUTH[role] });
      made.push(ctx);
      return ctx;
    });
    await Promise.all(made.map(c => c.dispose()));
  },
  anon: async ({}, use) => {
    const ctx = await pwRequest.newContext({ baseURL: BASE_URL });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };

let counter = 0;
// A name that is unique within a run, so specs never collide on titles / invoice numbers.
export const uniq = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}`;
