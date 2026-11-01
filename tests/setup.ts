import '@testing-library/jest-dom';
import { vi } from 'vitest';

// モック: fetch関数（テスト内でオーバーライドして使用）
global.fetch = vi.fn();

// App Router の useRouter, useSearchParams などのモック用
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The "prove it again" for high-risk actions (lib/reauth.ts) is covered by tests/unit/reauth.test.ts and e2e/reauth.spec.ts; the route tests here
// have no real session to judge, so for them the check always lets the call go on.
vi.mock('@/lib/reauth', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/reauth')>()), recentAuthOrResponse: vi.fn(async () => null) }));
