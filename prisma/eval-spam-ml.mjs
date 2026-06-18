// Evaluate ML spam classifier confidence on all spam-labeled threads
// Usage: node prisma/eval-spam-ml.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function buildFeatureTokens({ fromEmail, subject = '', textBody = '', fromName, hasAttachments }) {
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const tokens = [];
  tokens.push(`d:${domain}`, `d:${domain}`, `d:${domain}`);
  tokens.push(`e:${fromEmail.toLowerCase()}`);
  if (fromName) tokens.push(`n:${fromName.toLowerCase().replace(/\s+/g, '_')}`);
  const subj = subject.replace(/\s+/g, '');
  for (let i = 0; i <= subj.length - 3; i++) { const tri = `s:${subj.slice(i, i+3)}`; tokens.push(tri, tri); }
  const body = textBody.slice(0, 300).replace(/\s+/g, '');
  for (let i = 0; i <= body.length - 3; i++) tokens.push(`b:${body.slice(i, i+3)}`);
  if (hasAttachments) tokens.push('has_attachment');
  return tokens;
}

function predict(model, tokens) {
  const { classes, classLogPriors, featureLogProbs, unknownLogProbs } = model;
  const logScores = classLogPriors.map((prior, ci) => {
    let score = prior;
    for (const t of tokens) {
      const probs = featureLogProbs[t];
      score += probs ? probs[ci] : unknownLogProbs[ci];
    }
    return score;
  });
  const bestIdx = logScores[0] >= logScores[1] ? 0 : 1;
  const secondIdx = 1 - bestIdx;
  const confidence = 1 / (1 + Math.exp(logScores[secondIdx] - logScores[bestIdx]));
  return { label: classes[bestIdx], confidence };
}

async function main() {
  const modelRow = await prisma.ml_spam_model.findFirst({ orderBy: { trained_at: 'desc' } });
  if (!modelRow) { console.error('モデル未学習。管理画面でアップロードしてください。'); process.exit(1); }

  const model = JSON.parse(modelRow.model_data);
  console.log(`モデル学習日時: ${new Date(model.trainedAt ?? modelRow.trained_at).toLocaleString('ja-JP')}`);
  console.log(`学習サンプル: spam ${modelRow.spam_count}件 / ham ${modelRow.ham_count}件\n`);

  const spamThreads = await prisma.threads.findMany({
    where: { is_spam: true },
    include: { messages: { take: 1, orderBy: { sent_at: 'asc' }, select: { from_email: true, subject: true, text_body: true, from_name: true, has_attachments: true } } },
    orderBy: { spam_flagged_at: 'desc' },
  });

  if (spamThreads.length === 0) { console.log('迷惑メール登録スレッドなし。'); return; }

  let correctCount = 0, highConfidenceCount = 0;
  const rows = [];

  for (const t of spamThreads) {
    const msg = t.messages[0];
    if (!msg) continue;
    const tokens = buildFeatureTokens({ fromEmail: msg.from_email, subject: msg.subject, textBody: msg.text_body, fromName: msg.from_name, hasAttachments: msg.has_attachments });
    const { label, confidence } = predict(model, tokens);
    const isCorrect = label === 'spam';
    if (isCorrect) correctCount++;
    if (isCorrect && confidence >= 0.95) highConfidenceCount++;
    rows.push({ subject: (t.subject || '').slice(0, 40), from: msg.from_email.slice(0, 30), reason: t.spam_reason ?? '—', predicted: label, confidence: (confidence * 100).toFixed(1) + '%', ok: isCorrect ? '✓' : '✗' });
  }

  const col = (s, n) => String(s).padEnd(n);
  const header = col('', 2) + col('件名', 42) + col('送信者', 32) + col('登録理由', 14) + col('予測', 6) + col('信頼度', 8);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) console.log(col(r.ok, 2) + col(r.subject, 42) + col(r.from, 32) + col(r.reason, 14) + col(r.predicted, 6) + col(r.confidence, 8));

  const total = rows.length;
  console.log(`\n正解率: ${correctCount}/${total} (${((correctCount/total)*100).toFixed(1)}%)`);
  console.log(`信頼度95%以上で正解: ${highConfidenceCount}/${total} (${((highConfidenceCount/total)*100).toFixed(1)}%)`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
