import { execSync } from 'child_process';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, DATABASE_URL, ENCRYPTION_KEY_HEX, MM_URL, PORT } from './e2e/helpers/constants';

// Build the throw-away schema once (the main process; workers inherit the flag through the environment).
if (!process.env.PW_E2E_DB_PREPARED) {
  execSync('npx prisma db push --force-reset --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL }, stdio: 'ignore',
  });
  process.env.PW_E2E_DB_PREPARED = '1';
}

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One shared database: specs run one after another and reset the tables they use.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } }, testIgnore: /.*\.mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /.*\.mobile\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret-at-least-32-characters-long',
      ENCRYPTION_KEY_HEX,
      ENCRYPTION_KEY_VERSION: 'v1',
      NEXT_PUBLIC_APP_URL: BASE_URL,
      MATTERMOST_BASE_URL: MM_URL,
      MATTERMOST_BOT_TOKEN: 'e2e-bot-token',
      GOOGLE_CLIENT_ID: 'e2e-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'e2e-secret',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
