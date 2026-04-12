import '@testing-library/jest-dom';
import { vi } from 'vitest';

// モック: fetch関数（テスト内でオーバーライドして使用）
global.fetch = vi.fn();

// App Router の useRouter, useSearchParams などのモック用
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
