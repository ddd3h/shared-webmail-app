import dns from 'dns/promises';
import { prisma } from '@/lib/db';
import { predictSpam } from '@/lib/spam-classifier';
import { getSetting } from '@/lib/settings';

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
// Precedence: exact address beats domain, so a domain whitelist entry cannot
// override an individually blocklisted address (and vice versa).

export async function checkSenderLists(fromEmail: string): Promise<'whitelist' | 'blocklist' | null> {
  const addr = fromEmail.toLowerCase();
  if (!addr) return null;
  const domain = addr.split('@')[1] || '';

  const entries = await prisma.spam_senders.findMany({
    where: { type: { in: ['whitelist', 'blocklist'] } },
    select: { type: true, address: true },
  });
  const whitelist = new Set(entries.filter(e => e.type === 'whitelist').map(e => e.address.toLowerCase()));
  const blocklist = new Set(entries.filter(e => e.type === 'blocklist').map(e => e.address.toLowerCase()));

  if (whitelist.has(addr)) return 'whitelist';
  if (blocklist.has(addr)) return 'blocklist';
  if (domain && whitelist.has(domain)) return 'whitelist';
  if (domain && blocklist.has(domain)) return 'blocklist';
  return null;
}

// --- Main detection function ---

export type SpamResult = { isSpam: true; reason: string } | null;

export async function detectSpam(params: {
  fromEmail: string;
  receivedHeaders: string[];
  subject?: string;
  textBody?: string;
  fromName?: string | null;
  hasAttachments?: boolean;
}): Promise<SpamResult> {
  const { fromEmail, receivedHeaders, subject = '', textBody = '', fromName, hasAttachments } = params;
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';

  // 1-2. Whitelist / blocklist check (exact address beats domain match)
  const listResult = await checkSenderLists(fromEmail);
  if (listResult === 'whitelist') return null;
  if (listResult === 'blocklist') {
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

  // 6. ML classification — threshold is the average per-token log-odds margin
  // (delta / n). Default 0.5 is calibrated against measured spam samples
  // (delta/n 0.53-1.63); see docs/16_spam_detection.md §3-5.
  try {
    const thresholdStr = await getSetting('SPAM_DELTA_THRESHOLD');
    const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.5;
    const mlResult = await predictSpam({ fromEmail, subject, textBody, fromName, hasAttachments });
    if (mlResult?.label === 'spam') {
      const deltaNormalized = mlResult.delta / mlResult.n;
      if (deltaNormalized >= threshold) {
        return { isSpam: true, reason: 'ml_model' };
      }
    }
  } catch {
    // ML failure must not block mail sync
  }

  // 7. Final whitelist re-check (race condition guard)
  if ((await checkSenderLists(fromEmail)) === 'whitelist') return null;

  return null;
}
