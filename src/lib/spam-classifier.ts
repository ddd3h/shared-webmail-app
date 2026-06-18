import { prisma } from '@/lib/db';

type SpamPrediction = { label: 'spam' | 'ham'; confidence: number } | null;

type ModelJson = {
  classes: string[];
  classLogPriors: number[];
  featureLogProbs: Record<string, number[]>;
  unknownLogProbs: number[];
  spamCount: number;
  hamCount: number;
  trainedAt: string;
};

let modelCache: { model: ModelJson; loadedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Character-trigram feature extractor — language-agnostic (Japanese/ASCII/mixed).
// Must stay in sync with scripts/train-spam-model.py build_tokens().
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

  tokens.push(`d:${domain}`, `d:${domain}`, `d:${domain}`);
  tokens.push(`e:${fromEmail.toLowerCase()}`);
  if (fromName) tokens.push(`n:${fromName.toLowerCase().replace(/\s+/g, '_')}`);

  const subj = subject.replace(/\s+/g, '');
  for (let i = 0; i <= subj.length - 3; i++) {
    const tri = `s:${subj.slice(i, i + 3)}`;
    tokens.push(tri, tri);
  }

  const body = textBody.slice(0, 300).replace(/\s+/g, '');
  for (let i = 0; i <= body.length - 3; i++) {
    tokens.push(`b:${body.slice(i, i + 3)}`);
  }

  if (hasAttachments) tokens.push('has_attachment');
  return tokens;
}

function predict(model: ModelJson, tokens: string[]): SpamPrediction {
  const { classes, classLogPriors, featureLogProbs, unknownLogProbs } = model;

  const logScores = classLogPriors.map((prior, ci) => {
    let score = prior;
    for (const token of tokens) {
      const probs = featureLogProbs[token];
      score += probs ? probs[ci] : unknownLogProbs[ci];
    }
    return score;
  });

  const bestIdx = logScores[0] >= logScores[1] ? 0 : 1;
  const secondIdx = 1 - bestIdx;

  // Softmax: 1 / (1 + exp(second - best))
  const confidence = 1 / (1 + Math.exp(logScores[secondIdx] - logScores[bestIdx]));

  return { label: classes[bestIdx] as 'spam' | 'ham', confidence };
}

async function loadModel(): Promise<ModelJson | null> {
  const now = Date.now();
  if (modelCache && now - modelCache.loadedAt < CACHE_TTL_MS) return modelCache.model;

  const row = await prisma.ml_spam_model.findFirst({ orderBy: { trained_at: 'desc' } });
  if (!row) return null;

  const model = JSON.parse(row.model_data) as ModelJson;
  modelCache = { model, loadedAt: now };
  return model;
}

export async function predictSpam(params: {
  fromEmail: string;
  subject?: string;
  textBody?: string;
  fromName?: string | null;
  hasAttachments?: boolean;
}): Promise<SpamPrediction> {
  const model = await loadModel();
  if (!model) return null;
  return predict(model, buildFeatureTokens(params));
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
    return { label, fromEmail: msg.from_email, subject: msg.subject, textBody: msg.text_body ?? '', fromName: msg.from_name ?? null, hasAttachments: msg.has_attachments };
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
