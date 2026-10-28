import { NextRequest, NextResponse } from 'next/server';
import { gateAddress } from '@/lib/login-guard';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { issueChallenge } from '@/lib/remember-login';

// POST /api/auth/resume/challenge - step 1 of logging in again with the installed app's device key: a note to sign.
// It says nothing about whether this browser is known (a note is given to anybody), and is good for one answer, 2 minutes.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const address = await gateAddress(ip);
  if (!address.ok) return NextResponse.json({ error: address.error }, { status: address.status });
  if (!checkRateLimit(`resume:challenge:${ip}`, 30, 60_000).allowed) return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  return NextResponse.json({ challenge: await issueChallenge(ip) });
}
