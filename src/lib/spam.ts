import dns from 'dns/promises';
import { prisma } from '@/lib/db';

// --- IP helpers ---

function isPrivateIp(ip: string): boolean {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    ip.startsWith('::1') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

function reverseIp(ip: string): string {
  return ip.split('.').reverse().join('.');
}

export function extractSenderIp(receivedHeaders: string[]): string | null {
  // Walk received headers from the end (most trusted) to find first external IP
  for (const header of [...receivedHeaders].reverse()) {
    const match = header.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
    if (match) {
      const ip = match[1];
      if (!isPrivateIp(ip)) return ip;
    }
  }
  return null;
}

// --- DNSBL lookups ---

async function checkDnsbl(hostname: string): Promise<boolean> {
  try {
    await dns.resolve4(hostname);
    return true; // listed
  } catch {
    return false; // not listed or DNS error
  }
}

async function checkSpamhausIp(ip: string): Promise<boolean> {
  if (isPrivateIp(ip)) return false;
  return checkDnsbl(`${reverseIp(ip)}.zen.spamhaus.org`);
}

async function checkSpamhausDomain(domain: string): Promise<boolean> {
  if (!domain || domain.length === 0) return false;
  return checkDnsbl(`${domain}.dbl.spamhaus.org`);
}

// --- Heuristic rules ---

const SPAM_SUBJECT_PATTERNS = [
  /urgent.*wire transfer/i,
  /you.*won.*prize/i,
  /click here to claim/i,
  /\$\d+.*guaranteed/i,
  /make money fast/i,
  /100%\s*free/i,
  /casino|poker|gambling/i,
  /v[1i]agra|c[1i]al[1i]s/i,
  /enlarge.*penis/i,
];

const SPAM_BODY_PATTERNS = [
  /unsubscribe.*here/i,
  /this is not spam/i,
  /remove me from/i,
];

function hasSpamKeywords(subject: string, body: string): boolean {
  for (const pat of SPAM_SUBJECT_PATTERNS) {
    if (pat.test(subject)) return true;
  }
  for (const pat of SPAM_BODY_PATTERNS) {
    if (pat.test(body)) return true;
  }
  return false;
}

// --- Whitelist / blocklist DB check ---

async function isWhitelisted(fromEmail: string): Promise<boolean> {
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const addr = fromEmail.toLowerCase();
  const entries = await prisma.spam_senders.findMany({
    where: { type: 'whitelist' },
    select: { address: true },
  });
  return entries.some(e => addr === e.address.toLowerCase() || domain === e.address.toLowerCase());
}

async function isBlocklisted(fromEmail: string): Promise<boolean> {
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const addr = fromEmail.toLowerCase();
  const entries = await prisma.spam_senders.findMany({
    where: { type: 'blocklist' },
    select: { address: true },
  });
  return entries.some(e => addr === e.address.toLowerCase() || domain === e.address.toLowerCase());
}

// --- Main detection function ---

export type SpamResult = { isSpam: true; reason: string } | null;

export async function detectSpam(params: {
  fromEmail: string;
  receivedHeaders: string[];
  subject?: string;
  textBody?: string;
}): Promise<SpamResult> {
  const { fromEmail, receivedHeaders, subject = '', textBody = '' } = params;
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';

  // 1. Whitelist check — overrides everything
  if (await isWhitelisted(fromEmail)) return null;

  // 2. Blocklist check
  if (await isBlocklisted(fromEmail)) {
    return { isSpam: true, reason: 'blocklist' };
  }

  // 3. Spamhaus IP check
  const senderIp = extractSenderIp(receivedHeaders);
  if (senderIp && await checkSpamhausIp(senderIp)) {
    return { isSpam: true, reason: 'spamhaus_ip' };
  }

  // 4. Spamhaus domain check
  if (domain && await checkSpamhausDomain(domain)) {
    return { isSpam: true, reason: 'spamhaus_domain' };
  }

  // 5. Heuristic keyword check
  if (hasSpamKeywords(subject, textBody)) {
    return { isSpam: true, reason: 'heuristic' };
  }

  // 6. Final whitelist re-check (race condition guard)
  if (await isWhitelisted(fromEmail)) return null;

  return null;
}
