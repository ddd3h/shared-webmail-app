#!/usr/bin/env node
// Local spam model trainer — runs on your PC, no DB access needed.
//
// Usage:
//   node scripts/train-spam-model.mjs training-data.json [model.json]
//
// Workflow:
//   1. Export training data: GET /api/admin/spam-classifier/export → training-data.json
//   2. Run this script: node scripts/train-spam-model.mjs training-data.json
//   3. Upload result:   PUT /api/admin/spam-classifier/model  (or via admin UI)

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const natural = require('natural');

const inputFile = process.argv[2];
const outputFile = process.argv[3] || 'model.json';

if (!inputFile) {
  console.error('Usage: node scripts/train-spam-model.mjs training-data.json [model.json]');
  process.exit(1);
}

function buildFeatureTokens({ fromEmail, subject = '', textBody = '', fromName, hasAttachments }) {
  const domain = fromEmail.split('@')[1]?.toLowerCase() || '';
  const tokens = [];

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

const data = JSON.parse(readFileSync(inputFile, 'utf-8'));
const items = data.items;

if (!Array.isArray(items) || items.length === 0) {
  console.error('items が空です');
  process.exit(1);
}

const spamItems = items.filter(i => i.label === 'spam');
const hamItems = items.filter(i => i.label === 'ham');

console.log(`学習データ: spam ${spamItems.length}件 / ham ${hamItems.length}件`);

if (spamItems.length < 5 || hamItems.length < 5) {
  console.error('データ不足（最低5件ずつ必要）');
  process.exit(1);
}

const classifier = new natural.BayesClassifier();

for (const item of spamItems) {
  classifier.addDocument(buildFeatureTokens(item), 'spam');
}
for (const item of hamItems) {
  classifier.addDocument(buildFeatureTokens(item), 'ham');
}

classifier.train();
console.log('学習完了');

const output = {
  modelData: JSON.stringify(classifier),
  spamCount: spamItems.length,
  hamCount: hamItems.length,
  trainedAt: new Date().toISOString(),
};

writeFileSync(outputFile, JSON.stringify(output, null, 2));
console.log(`モデルを保存: ${outputFile}`);
console.log('次のステップ: 管理画面からこのファイルをアップロードしてください');
