import { NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';

async function getValidAccessToken(userId: string): Promise<string | null> {
  const stored = await prisma.google_oauth_tokens.findUnique({ where: { user_id: userId } });
  if (!stored) return null;

  const tokenData = JSON.parse(await decrypt(stored.encrypted_token));
  const expiresAt = new Date(tokenData.expires_at).getTime();

  // Refresh if expired (with 60s margin)
  if (Date.now() > expiresAt - 60_000) {
    if (!tokenData.refresh_token) return null;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      })
    });
    if (!res.ok) return null;
    const refreshed = await res.json();
    const newExpires = new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString();
    const newToken = JSON.stringify({ access_token: refreshed.access_token, refresh_token: tokenData.refresh_token, expires_at: newExpires });
    await prisma.google_oauth_tokens.update({ where: { user_id: userId }, data: { encrypted_token: await encrypt(newToken) } });
    return refreshed.access_token;
  }

  return tokenData.access_token;
}

export async function POST() {
  const session = await getSession();
  requireAuth(session);

  const accessToken = await getValidAccessToken(session.userId);
  if (!accessToken) {
    return NextResponse.json({ error: 'not_linked' }, { status: 401 });
  }

  // --- PART 1: Local -> Google (Push new local contacts) ---
  const localOnly = await prisma.contacts.findMany({
    where: { google_id: null, created_by: session.userId }
  });

  let pushed = 0;
  for (const contact of localOnly) {
    try {
      const gBody = {
        names: [{ givenName: contact.name }],
        emailAddresses: contact.email ? [{ value: contact.email }] : [],
        phoneNumbers: contact.phone ? [{ value: contact.phone }] : [],
        organizations: (contact.company || contact.department) ? [{
          name: contact.company || '',
          department: contact.department || ''
        }] : []
      };

      const gRes = await fetch('https://people.googleapis.com/v1/people:createContact', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(gBody)
      });

      if (gRes.ok) {
        const created = await gRes.json();
        await prisma.contacts.update({
          where: { id: contact.id },
          data: { google_id: created.resourceName, source: 'google' }
        });
        pushed++;
      }
    } catch (e) {
      console.error(`Failed to push contact ${contact.id} to Google:`, e);
    }
  }

  // --- PART 2: Google -> Local (Pull/Update existing) ---
  // Fetch all connections from Google People API (paginated)
  let allPeople: any[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      personFields: 'names,emailAddresses,phoneNumbers,organizations',
      pageSize: '1000',
      ...(pageToken ? { pageToken } : {})
    });
    const res = await fetch(`https://people.googleapis.com/v1/people/me/connections?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return NextResponse.json({ error: 'google_api_failed' }, { status: 502 });
    const data = await res.json();
    allPeople = allPeople.concat(data.connections || []);
    pageToken = data.nextPageToken;
  } while (pageToken);

  let pulled = 0;
  let skipped = 0;

  for (const person of allPeople) {
    const googleId: string = person.resourceName;
    const name: string = person.names?.[0]?.displayName?.trim() || '';
    if (!name) { skipped++; continue; }

    const email: string | null = person.emailAddresses?.[0]?.value?.trim() || null;
    const phone: string | null = person.phoneNumbers?.[0]?.value?.trim() || null;
    const company: string | null = person.organizations?.[0]?.name?.trim() || null;
    const department: string | null = person.organizations?.[0]?.department?.trim() || null;

    await prisma.contacts.upsert({
      where: { google_id: googleId },
      create: { name, email, phone, company, department, source: 'google', google_id: googleId, created_by: session.userId },
      update: { name, email, phone, company, department }
    });
    pulled++;
  }

  return NextResponse.json({ pushed, pulled, skipped, total_google: allPeople.length });
}

// Check if the current user has linked Google
export async function GET() {
  const session = await getSession();
  requireAuth(session);

  const token = await prisma.google_oauth_tokens.findUnique({ where: { user_id: session.userId } });
  return NextResponse.json({ linked: !!token });
}

// Disconnect Google account
export async function DELETE() {
  const session = await getSession();
  requireAuth(session);

  await prisma.google_oauth_tokens.deleteMany({
    where: { user_id: session.userId }
  });

  return NextResponse.json({ ok: true });
}
