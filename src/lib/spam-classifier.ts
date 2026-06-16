import natural from 'natural';
import { prisma } from '@/lib/db';

type SpamPrediction = { label: 'spam' | 'ham'; confidence: number } | null;

let modelCache: { classifier: ReturnType<typeof natural.BayesClassifier.restore>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

function buildFeatureText(params: {
  fromEmail: string;
  subject?: string;
  textBody?: string;
  fromName?: string | null;
  hasAttachments?: boolean;
}): string {
  const { fromEmail, subject = '', textBody = '', fromName, hasAttachments } = params;
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  return [
    subject, subject,
    `DOMAIN_${domain} DOMAIN_${domain} DOMAIN_${domain}`,
    fromName ?? '',
    textBody.slice(0, 500),
    hasAttachments ? 'HAS_ATTACHMENT' : '',
  ].join(' ').trim();
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

  const text = buildFeatureText(params);
  const classifications: { label: string; value: number }[] = classifier.getClassifications(text);
  if (classifications.length < 2) return null;

  const sorted = [...classifications].sort((a, b) => b.value - a.value);
  const [best, second] = sorted;

  // Log-sum-exp softmax for numerical stability
  const expSecond = Math.exp(second.value - best.value);
  const confidence = 1 / (1 + expSecond);

  return {
    label: best.label as 'spam' | 'ham',
    confidence,
  };
}

export async function trainModel(): Promise<{ spamCount: number; hamCount: number }> {
  const [spamThreads, hamThreads] = await Promise.all([
    prisma.threads.findMany({
      where: { is_spam: true },
      include: { messages: { take: 1, orderBy: { sent_at: 'asc' } } },
    }),
    prisma.threads.findMany({
      where: { is_spam: false },
      include: { messages: { take: 1, orderBy: { sent_at: 'asc' } } },
    }),
  ]);

  const MIN_SAMPLES = 5;
  if (spamThreads.length < MIN_SAMPLES || hamThreads.length < MIN_SAMPLES) {
    throw new Error(
      `学習データ不足: spam=${spamThreads.length}件, ham=${hamThreads.length}件（最低${MIN_SAMPLES}件ずつ必要）`
    );
  }

  const classifier = new natural.BayesClassifier();

  for (const t of spamThreads) {
    const msg = t.messages[0];
    if (!msg) continue;
    classifier.addDocument(
      buildFeatureText({ fromEmail: msg.from_email, subject: msg.subject, textBody: msg.text_body ?? '', fromName: msg.from_name, hasAttachments: msg.has_attachments }),
      'spam'
    );
  }

  for (const t of hamThreads) {
    const msg = t.messages[0];
    if (!msg) continue;
    classifier.addDocument(
      buildFeatureText({ fromEmail: msg.from_email, subject: msg.subject, textBody: msg.text_body ?? '', fromName: msg.from_name, hasAttachments: msg.has_attachments }),
      'ham'
    );
  }

  classifier.train();

  await prisma.ml_spam_model.create({
    data: {
      model_data: JSON.stringify(classifier),
      trained_at: new Date(),
      spam_count: spamThreads.length,
      ham_count: hamThreads.length,
    },
  });

  modelCache = null;

  return { spamCount: spamThreads.length, hamCount: hamThreads.length };
}

export async function getModelStats() {
  return prisma.ml_spam_model.findFirst({
    orderBy: { trained_at: 'desc' },
    select: { trained_at: true, spam_count: true, ham_count: true, version: true },
  });
}
