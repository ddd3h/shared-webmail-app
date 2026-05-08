import { NextRequest, NextResponse } from 'next/server';
import { getSession, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Strip HTML to plain text for prompt context
function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// POST /api/ai/reply
// Reply mode:  { threadId, draft? }   — generate reply or proofread within thread context
// Compose mode: { subject, to, draft? } — generate new mail or proofread without thread context
export async function POST(req: NextRequest) {
  const session = await getSession();
  requireAuth(session);

  if (!OPENROUTER_API_KEY) {
    return NextResponse.json({ error: 'AI機能が設定されていません（OPENROUTER_API_KEY未設定）' }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid body' }, { status: 400 });

  const draftText = body.draft ? htmlToText(body.draft) : '';
  const isDraftEmpty = !draftText.trim();

  let systemPrompt: string;
  let userPrompt: string;

  if (body.threadId) {
    // ── Reply mode ──────────────────────────────────────────────
    const thread = await prisma.threads.findFirst({
      where: {
        id: body.threadId,
        mailbox: {
          OR: [
            { owner_user_id: session!.userId },
            { permissions: { some: { user_id: session!.userId, can_view: true } } },
          ],
        },
      },
      select: { id: true, subject: true },
    });
    if (!thread) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const messages = await prisma.messages.findMany({
      where: { thread_id: body.threadId },
      orderBy: { sent_at: 'asc' },
      take: 10,
      select: { direction: true, from_name: true, from_email: true, sent_at: true, text_body: true, html_body: true },
    });

    const me = await prisma.users.findUnique({
      where: { id: session!.userId },
      select: { name: true },
    });

    const conversationText = messages.map(m => {
      const who = m.direction === 'outgoing'
        ? `【送信済み / ${me?.name || '自分'}】`
        : `【受信 / ${m.from_name || m.from_email}】`;
      const text = m.text_body || htmlToText(m.html_body || '');
      return `${who} ${new Date(m.sent_at).toLocaleDateString('ja-JP')}\n${text.slice(0, 800)}`;
    }).join('\n\n---\n\n');

    systemPrompt = `あなたはビジネスメールの返信を日本語で作成するアシスタントです。
返信文のみを出力してください。件名・宛名・署名・前置きは不要です。
敬語を使い、簡潔かつ丁寧なビジネス文体にしてください。`;

    userPrompt = isDraftEmpty
      ? `以下のメールスレッドに対する返信文を作成してください。\n\n件名: ${thread.subject}\n\n【会話履歴】\n${conversationText}\n\n返信文（本文のみ）:`
      : `以下のメールスレッドの文脈をふまえ、作成中の返信文を校正・改善してください。\n内容は変えず、敬語・表現・読みやすさを改善した文章のみ出力してください。\n\n件名: ${thread.subject}\n\n【会話履歴】\n${conversationText}\n\n【現在の返信文（校正対象）】\n${draftText}\n\n改善後の返信文:`;

  } else {
    // ── Compose mode ─────────────────────────────────────────────
    if (isDraftEmpty && !body.subject) {
      return NextResponse.json({ error: '件名か本文を入力してから実行してください' }, { status: 400 });
    }

    const subjectLine = body.subject ? `件名: ${body.subject}` : '';
    const toLine = body.to ? `宛先: ${body.to}` : '';
    const context = [subjectLine, toLine].filter(Boolean).join('\n');

    systemPrompt = `あなたはビジネスメールの本文を日本語で作成するアシスタントです。
本文のみを出力してください。件名・宛名・署名・前置きは不要です。
敬語を使い、簡潔かつ丁寧なビジネス文体にしてください。`;

    userPrompt = isDraftEmpty
      ? `以下の情報をもとに、メールの本文を作成してください。\n\n${context}\n\n本文（本文のみ）:`
      : `以下のメール情報をふまえ、作成中の本文を校正・改善してください。\n内容は変えず、敬語・表現・読みやすさを改善した文章のみ出力してください。\n\n${context}\n\n【現在の本文（校正対象）】\n${draftText}\n\n改善後の本文:`;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': APP_URL,
      'X-Title': 'Shared Mail Workspace',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    console.error('OpenRouter error', response.status, err);
    return NextResponse.json({ error: 'AI APIエラーが発生しました' }, { status: 502 });
  }

  const json = await response.json();
  const text = json.choices?.[0]?.message?.content?.trim() ?? '';

  if (!text) {
    return NextResponse.json({ error: 'AIからの応答が空でした' }, { status: 502 });
  }

  // Return as plain text (the client will set it into the editor)
  return NextResponse.json({ text });
}
