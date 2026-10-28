// Refuses robots: AI crawlers, scrapers, scripts and headless browsers that say what they are in the User-Agent.
//
// This only stops robots that tell the truth about themselves (every well-known AI crawler does); a script can put any
// text in User-Agent. What stops the others is the rest of the app: login only from the address a session began on,
// 2-step login, the request budgets and the sweep detection.

export type BotKind = 'ai_crawler' | 'script' | 'headless' | 'no_user_agent';

// Crawlers that collect text for AI training / AI search / AI assistants, and SEO / social scrapers.
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'CCBot', 'Google-Extended', 'GoogleOther', 'Google-CloudVertexBot', 'Gemini-Deep-Research',
  'Bytespider', 'Amazonbot', 'Applebot', 'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot', 'facebookexternalhit',
  'cohere-ai', 'cohere-training-data-crawler', 'Diffbot', 'ImagesiftBot', 'YouBot', 'Omgilibot', 'Timpibot', 'PetalBot',
  'AI2Bot', 'Ai2Bot-Dolma', 'DuckAssistBot', 'MistralAI-User', 'Webzio', 'iaskspider', 'ICC-Crawler', 'img2dataset',
  'SemrushBot', 'AhrefsBot', 'MJ12bot', 'DotBot', 'Kangaroo Bot', 'Scrapy', 'Firecrawl', 'Crawl4AI', 'BrightData', 'ZoomInfo',
];
const AI_RE = new RegExp(AI_CRAWLERS.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

// Command-line tools, HTTP libraries and automation frameworks.
const SCRIPT_RE = /\b(curl|wget|httpie|postman|insomnia|libwww|lwp-|python-requests|python-urllib|python-httpx|httpx|aiohttp|urllib|go-http-client|okhttp|apache-httpclient|jakarta|java\/|reqwest|node-fetch|undici|axios|got \(|powershell|php\/|ruby|perl|spider|crawler|scraper|scrape|slurp)|^node$|\bbot\b|bot\/[\d.]|\+https?:\/\//i;
const HEADLESS_RE = /headlesschrome|phantomjs|puppeteer|playwright|selenium|webdriver|lighthouse|slimerjs|nightmare|cypress/i;

/** What kind of robot a User-Agent says it is (null = looks like a person's browser). `allow` are exceptions (monitoring tools, tests). */
export function botKind(ua: string | null | undefined, allow: string[] = []): BotKind | null {
  const s = (ua ?? '').trim();
  if (!s) return 'no_user_agent';
  const lower = s.toLowerCase();
  if (allow.some(a => a && lower.includes(a.toLowerCase()))) return null;
  if (AI_RE.test(s)) return 'ai_crawler';
  if (HEADLESS_RE.test(s)) return 'headless';
  if (SCRIPT_RE.test(s)) return 'script';
  return null;
}

/** BOT_ALLOW_UA="UptimeRobot,Playwright": User-Agent parts that are let through whatever they look like. */
export function botAllowList(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.BOT_ALLOW_UA ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

/** BOT_BLOCK=off turns the whole thing off from the environment (the admin setting is the normal switch). */
export const botBlockForcedOff = (env: NodeJS.ProcessEnv = process.env) => env.BOT_BLOCK === 'off';

export const BOT_KIND_LABEL: Record<BotKind, string> = {
  ai_crawler: 'AI・データ収集のクローラ', script: 'スクリプト・自動ツール', headless: '自動操作ブラウザ', no_user_agent: 'User-Agent が無い接続',
};
