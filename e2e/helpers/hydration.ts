import type { BrowserContext, Page } from '@playwright/test';

// The page is drawn by the server first and "wakes up" (React attaches its click handlers) a moment after the `load` event.
// A click in that gap is lost, which people never do but a test does at once. So `goto`/`reload` return once the page is awake.
// (parts of a page wake up separately, so every control that React draws must be awake; HTML shown as-is, like a mail body, has no React and is skipped)
const awake = () => {
  const controls = Array.from(document.querySelectorAll('button, input, select, textarea')).filter(el => !el.closest('[data-mail-body], iframe, .prose'));
  return controls.every(el => Object.keys(el).some(k => k.startsWith('__reactProps') || k.startsWith('__reactFiber')));
};

export async function waitUntilAwake(page: Page) {
  await page.waitForFunction(awake, null, { timeout: 5_000 }).catch(() => {}); // pages without any React (plain-text errors) simply continue
}

function patchPage(page: Page) {
  for (const name of ['goto', 'reload'] as const) {
    const original = page[name].bind(page) as (...a: unknown[]) => Promise<unknown>;
    (page as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => { const res = await original(...args); await waitUntilAwake(page); return res; };
  }
}

export function patchContext(ctx: BrowserContext): BrowserContext {
  ctx.pages().forEach(patchPage);
  ctx.on('page', patchPage);
  return ctx;
}
