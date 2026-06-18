#!/usr/bin/env python3
"""
Local spam model trainer — runs on your PC, no DB access needed.

Usage:
  python3 scripts/train-spam-model.py training-data.json [model.json]

Requirements:
  pip install scikit-learn

Workflow:
  1. Export: GET /api/admin/spam-classifier/export -> training-data.json
  2. Train:  python3 scripts/train-spam-model.py training-data.json
  3. Upload: PUT /api/admin/spam-classifier/model (or admin UI)
"""

import json
import sys
import math
import time
from datetime import datetime, timezone
from multiprocessing import Pool, cpu_count

try:
    from sklearn.naive_bayes import ComplementNB
    import numpy as np
    from scipy.sparse import lil_matrix, csr_matrix
except ImportError:
    print("pip install scikit-learn numpy scipy")
    sys.exit(1)

INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else None
OUTPUT_FILE = sys.argv[2] if len(sys.argv) > 2 else "model.json"

if not INPUT_FILE:
    print("Usage: python3 scripts/train-spam-model.py training-data.json [model.json]")
    sys.exit(1)


def build_tokens(item):
    """Character-trigram feature extractor — language-agnostic (Japanese/ASCII/mixed)."""
    from_email = (item.get("fromEmail") or "").lower()
    subject    = (item.get("subject") or "")
    text_body  = (item.get("textBody") or "")[:300]
    from_name  = (item.get("fromName") or "")
    has_attach = item.get("hasAttachments", False)

    domain = from_email.split("@")[1] if "@" in from_email else ""
    tokens = []

    # Domain — 3x weight
    tokens += [f"d:{domain}"] * 3
    tokens.append(f"e:{from_email}")

    if from_name:
        tokens.append(f"n:{from_name.lower().replace(' ', '_')}")

    # Subject trigrams — 2x weight
    s = subject.replace(" ", "")
    for i in range(len(s) - 2):
        tri = f"s:{s[i:i+3]}"
        tokens += [tri, tri]

    # Body trigrams
    b = text_body.replace(" ", "")
    for i in range(len(b) - 2):
        tokens.append(f"b:{b[i:i+3]}")

    if has_attach:
        tokens.append("has_attachment")

    return tokens


def extract_tokens_parallel(items):
    """Parallel feature extraction using all available CPU cores."""
    workers = min(cpu_count(), len(items))
    with Pool(workers) as pool:
        return pool.map(build_tokens, items)


def build_vocab_and_matrix(token_lists):
    """Build vocabulary and sparse document-term count matrix."""
    vocab = {}
    for tl in token_lists:
        for t in tl:
            if t not in vocab:
                vocab[t] = len(vocab)

    # Sparse matrix — avoids n_docs × vocab_size dense allocation (would be GBs)
    X = lil_matrix((len(token_lists), len(vocab)), dtype=np.float32)
    for i, tl in enumerate(token_lists):
        for t in tl:
            X[i, vocab[t]] += 1
    return csr_matrix(X), vocab


def main():
    print(f"読み込み: {INPUT_FILE}")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    items = data.get("items", [])
    if not items:
        print("items が空です")
        sys.exit(1)

    spam_items = [x for x in items if x["label"] == "spam"]
    ham_items  = [x for x in items if x["label"] == "ham"]
    print(f"学習データ: spam {len(spam_items)}件 / ham {len(ham_items)}件")

    if len(spam_items) < 5 or len(ham_items) < 5:
        print("データ不足（最低5件ずつ必要）")
        sys.exit(1)

    all_items = spam_items + ham_items
    labels = ["spam"] * len(spam_items) + ["ham"] * len(ham_items)
    classes = ["spam", "ham"]

    # Parallel feature extraction
    t0 = time.time()
    print(f"特徴量抽出中 (workers={min(cpu_count(), len(all_items))})...")
    token_lists = extract_tokens_parallel(all_items)
    print(f"  完了: {time.time() - t0:.2f}s")

    # Build vocabulary and count matrix
    X, vocab = build_vocab_and_matrix(token_lists)
    y = np.array([classes.index(l) for l in labels])
    print(f"語彙数: {len(vocab)}")

    # Train ComplementNB (better than MultinomialNB for imbalanced classes)
    t0 = time.time()
    print("学習中 (ComplementNB)...")
    clf = ComplementNB(alpha=1.0)
    clf.fit(X, y)
    print(f"  完了: {time.time() - t0:.2f}s")

    # Extract log-probabilities into portable JSON format
    # clf.feature_log_prob_: shape (n_classes, n_features)
    # clf.class_log_prior_:  shape (n_classes,)
    vocab_list = sorted(vocab.keys(), key=lambda k: vocab[k])

    # Unknown token log-prob: use smoothed estimate for OOV
    # = log(alpha / (sum_of_class_token_counts + alpha * vocab_size))
    alpha = 1.0
    vocab_size = len(vocab)
    unknown_log_probs = []
    for ci in range(len(classes)):
        class_token_sum = X[y == ci].sum()
        unk = math.log(alpha / (class_token_sum + alpha * vocab_size))
        unknown_log_probs.append(unk)

    feature_log_probs = {}
    for fi, token in enumerate(vocab_list):
        feature_log_probs[token] = [float(clf.feature_log_prob_[ci][fi]) for ci in range(len(classes))]

    model = {
        "classes": classes,
        "classLogPriors": [float(clf.class_log_prior_[ci]) for ci in range(len(classes))],
        "featureLogProbs": feature_log_probs,
        "unknownLogProbs": unknown_log_probs,
        "vocabSize": vocab_size,
        "spamCount": len(spam_items),
        "hamCount": len(ham_items),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))

    print(f"モデルを保存: {OUTPUT_FILE}")
    print("次のステップ: 管理画面からこのファイルをアップロードしてください")


if __name__ == "__main__":
    main()
