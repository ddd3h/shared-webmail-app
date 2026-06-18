import natural from 'natural';
import { prisma } from '@/lib/db';

type SpamPrediction = { label: 'spam' | 'ham'; confidence: number } | null;

let modelCache: { classifier: ReturnType<typeof natural.BayesClassifier.restore>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Build pre-tokenized feature array that bypasses natural's English-only Porter stemmer.
// Uses character trigrams for language-agnostic text coverage (Japanese, ASCII, mixed).
export function buildFeatureTokens(params: {
  fromEmail: string;
  subject?: string;
  textBody?: string;
  fromName?: string | null;
  hasAttachments?: boolean;
}): string[] {
  const { fromEmail, subject = '', textBody = '', fromName, hasAttachments } = params;
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const tokens: string[] = [];

  // Domain — 3x weight (highly distinctive signal)
  tokens.push(`d:${domain}`, `d:${domain}`, `d:${domain}`);

  // Full sender address
  tokens.push(`e:${fromEmail.toLowerCase()}`);

  // From name as single token
  if (fromName) tokens.push(`n:${fromName.toLowerCase().replace(/\s+/g, '_')}`);

  // Subject — character trigrams, 2x weight (language-agnostic)
  const subj = subject.replace(/\s+/g, '');
  for (let i = 0; i <= subj.length - 3; i++) {
    const tri = `s:${subj.slice(i, i + 3)}`;
    tokens.push(tri, tri);
  }

  // Body first 300 chars — character trigrams
  const body = textBody.slice(0, 300).replace(/\s+/g, '');
  for (let i = 0; i <= body.length - 3; i++) {
    tokens.push(`b:${body.slice(i, i + 3)}`);
  }

  if (hasAttachments) tokens.push('has_attachment');

  return tokens;
}

async function loadModel() {
  const now = Date.now();
  if (modelCache && now - modelCache.loadedAt < CACHE_TTL_MS) {
    return modelCache.classifier;
  }

  const row = await prisma.ml_spam_model.findFirst({ orderBy: { trained_at: 'desc' } });
  if (!row) return null;

  const classifier = natural.BayesClassifier.restore(JSON.parse(row.model_data));
  modelCache = { classifier, loadedAt: now };
  return classifier;
}

export async function predictSpam(params: {
  fromEmail: string;
  subject?: string;
  textBody?: string;
  fromName?: string | null;
  hasAttachments?: boolean;
}): Promise<SpamPrediction> {
  const classifier = await loadModel();
  if (!classifier) return null;

  const tokens = buildFeatureTokens(params);
  const classifications: { label: string; value: number }[] = classifier.getClassifications(tokens);
  if (classifications.length < 2) return null;

  const sorted = [...classifications].sort((a, b) => b.value - a.value);
  const [best, second] = sorted;

  // Softmax over log-probabilities: 1 / (1 + exp(second - best))
  const confidence = 1 / (1 + Math.exp(second.value - best.value));

  return {
    label: best.label as 'spam' | 'ham',
    confidence,
  };
}

export async function saveModel(modelData: string, spamCount: number, hamCount: number) {
  await prisma.ml_spam_model.create({
    data: { model_data: modelData, trained_at: new Date(), spam_count: spamCount, ham_count: hamCount },
  });
  modelCache = null;
}

export async function getTrainingData() {
  const [spamThreads, hamThreads] = await Promise.all([
    prisma.threads.findMany({
      where: { is_spam: true },
      include: { messages: { take: 1, orderBy: { sent_at: 'asc' }, select: { from_email: true, subject: true, text_body: true, from_name: true, has_attachments: true } } },
    }),
    prisma.threads.findMany({
      where: { is_spam: false },
      include: { messages: { take: 1, orderBy: { sent_at: 'asc' }, select: { from_email: true, subject: true, text_body: true, from_name: true, has_attachments: true } } },
    }),
  ]);

  const toItem = (label: 'spam' | 'ham') => (t: typeof spamThreads[number]) => {
    const msg = t.messages[0];
    if (!msg) return null;
    return {
      label,
      fromEmail: msg.from_email,
      subject: msg.subject,
      textBody: msg.text_body ?? '',
      fromName: msg.from_name ?? null,
      hasAttachments: msg.has_attachments,
    };
  };

  return [
    ...spamThreads.map(toItem('spam')).filter(Boolean),
    ...hamThreads.map(toItem('ham')).filter(Boolean),
  ];
}

export async function getModelStats() {
  return prisma.ml_spam_model.findFirst({
    orderBy: { trained_at: 'desc' },
    select: { trained_at: true, spam_count: true, ham_count: true, version: true },
  });
}
