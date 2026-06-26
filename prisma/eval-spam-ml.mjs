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
  const delta = logScores[bestIdx] - logScores[secondIdx];
  return { label: classes[bestIdx], delta, n: tokens.length };
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
    const { label, delta, n } = predict(model, tokens);
    const deltaNorm = delta / n;
    const isCorrect = label === 'spam';
    if (isCorrect) correctCount++;
    rows.push({ subject: (t.subject || '').slice(0, 38), from: msg.from_email.slice(0, 28), reason: t.spam_reason ?? '—', predicted: label, delta: delta.toFixed(1), n: String(n), deltaNorm: deltaNorm.toFixed(2), ok: isCorrect ? '✓' : '✗' });
  }

  const col = (s, w) => String(s).padEnd(w);
  const header = col('', 2) + col('件名', 40) + col('送信者', 30) + col('登録理由', 14) + col('予測', 6) + col('delta', 10) + col('n', 6) + col('delta/n', 9);
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const r of rows) console.log(col(r.ok, 2) + col(r.subject, 40) + col(r.from, 30) + col(r.reason, 14) + col(r.predicted, 6) + col(r.delta, 10) + col(r.n, 6) + col(r.deltaNorm, 9));

  const total = rows.length;
  console.log(`\n正解率: ${correctCount}/${total} (${((correctCount/total)*100).toFixed(1)}%)`);

  const spamRows = rows.filter(r => r.predicted === 'spam');
  const hamRows  = rows.filter(r => r.predicted === 'ham');
  if (spamRows.length) {
    const avg = spamRows.reduce((s, r) => s + parseFloat(r.deltaNorm), 0) / spamRows.length;
    console.log(`spam 判定の delta/n 平均: ${avg.toFixed(2)} (n=${spamRows.length})`);
  }
  if (hamRows.length) {
    const avg = hamRows.reduce((s, r) => s + parseFloat(r.deltaNorm), 0) / hamRows.length;
    console.log(`ham  判定の delta/n 平均: ${avg.toFixed(2)} (n=${hamRows.length}) ← 誤検知候補`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
