import { describe, it, expect } from 'vitest';
import { botKind, botAllowList, botBlockForcedOff } from '@/lib/bot-guard';

// what real people's browsers send
const BROWSERS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 12; CUBOT_P50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
];

describe('botKind', () => {
  it('人のブラウザは通す（Android の機種名に bot が入っていても）', () => {
    for (const ua of BROWSERS) expect(botKind(ua), ua).toBeNull();
  });
  it('AI・データ収集のクローラを見分ける', () => {
    for (const ua of [
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)',
      'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
      'ChatGPT-User/1.0', 'PerplexityBot/1.0', 'CCBot/2.0 (https://commoncrawl.org/faq/)', 'Bytespider', 'Amazonbot/0.1',
      'Mozilla/5.0 (compatible; Google-Extended)', 'Meta-ExternalAgent/1.1', 'anthropic-ai', 'Applebot-Extended',
    ]) expect(botKind(ua), ua).toBe('ai_crawler');
  });
  it('コマンドラインやHTTPライブラリを見分ける', () => {
    for (const ua of ['curl/8.5.0', 'Wget/1.21', 'python-requests/2.31.0', 'Python-urllib/3.11', 'Go-http-client/1.1', 'okhttp/4.12.0', 'axios/1.7.2', 'node', 'node-fetch/1.0', 'Java/17.0.2', 'PostmanRuntime/7.39', 'aiohttp/3.9', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; SomeSpider/1.0; +https://example.com/about)'])
      expect(botKind(ua), ua).toBe('script');
  });
  it('自動操作のブラウザを見分ける', () => {
    for (const ua of ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36', 'Mozilla/5.0 PhantomJS/2.1.1', 'Playwright/1.56.1 (x64; ubuntu 24.04) node/22.0', 'Mozilla/5.0 Chrome/126 Puppeteer', 'Lighthouse'])
      expect(botKind(ua), ua).toBe('headless');
  });
  it('User-Agent が無い接続は断る', () => {
    expect(botKind(undefined)).toBe('no_user_agent');
    expect(botKind(null)).toBe('no_user_agent');
    expect(botKind('   ')).toBe('no_user_agent');
  });
  it('許可リストに入れた名前は通す（監視ツールなど）', () => {
    expect(botKind('Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', [])).toBe('script');
    expect(botKind('Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)', ['uptimerobot'])).toBeNull();
    expect(botKind('Playwright/1.56.1 (x64)', ['Playwright/'])).toBeNull();
    expect(botKind('curl/8', [''])).toBe('script'); // an empty entry allows nothing
  });
});

describe('設定', () => {
  it('BOT_ALLOW_UA はカンマ区切り', () => {
    expect(botAllowList({ BOT_ALLOW_UA: ' UptimeRobot , Playwright/ ,' } as unknown as NodeJS.ProcessEnv)).toEqual(['UptimeRobot', 'Playwright/']);
    expect(botAllowList({} as NodeJS.ProcessEnv)).toEqual([]);
  });
  it('BOT_BLOCK=off のときだけ全体を止められる', () => {
    expect(botBlockForcedOff({ BOT_BLOCK: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(botBlockForcedOff({ BOT_BLOCK: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(botBlockForcedOff({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
