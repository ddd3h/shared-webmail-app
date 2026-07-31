# 迷惑メール検出システム

> 最終更新: 2026-06-26

---

## 1. 概要

受信メールに対して多層フィルタリングを実施し、迷惑メールを自動検出・隔離する。検出されたメールは通常タブから非表示になり、専用の「迷惑メール」タブに隔離される。通知（Push / Mattermost）も送らない。

---

## 2. 検出パイプライン

`src/lib/spam.ts` の `detectSpam()` が実行順序を制御する。**順序は厳守**。

リスト判定（①②）は `checkSenderLists()` に統合されており、**具体性優先**で評価する:
アドレス完全一致 whitelist → アドレス完全一致 blocklist → ドメイン一致 whitelist → ドメイン一致 blocklist。
ドメインをホワイトリストに入れても、個別アドレスのブロックリスト登録が優先される。

```
受信メッセージ
    │
    ▼
①② リスト確認（checkSenderLists）
    ├─(whitelist一致)──▶ スパムではない（終了）
    ├─(blocklist一致)──▶ spam / reason: "blocklist"
    │
    ▼
③ Spamhaus IP (zen.spamhaus.org) ──(リスト掲載)──▶ spam / reason: "spamhaus_ip"
    │
    ▼
④ Spamhaus Domain (dbl.spamhaus.org) ──(リスト掲載)──▶ spam / reason: "spamhaus_domain"
    │
    ▼
⑤ ヒューリスティック（件名・本文キーワード）──(一致)──▶ spam / reason: "heuristic"
    │
    ▼
⑥ ML分類（ComplementNB） ──(spam & 閾値以上)──▶ spam / reason: "ml_model"
    │
    ▼
⑦ ホワイトリスト再確認（レースコンディション対策）
    │
    ▼
スパムではない
```

### 各レイヤーの詳細

| # | レイヤー | データソース | 備考 |
|---|---|---|---|
| ① | ホワイトリスト | DB `spam_senders` (type='whitelist') | アドレス完全一致 > ドメイン一致（`checkSenderLists`で②と統合評価） |
| ② | ブロックリスト | DB `spam_senders` (type='blocklist') | アドレス完全一致はドメインwhitelistより優先 |
| ③ | Spamhaus IP | DNS `{逆順IP}.zen.spamhaus.org` | Receivedヘッダーから外部IPを抽出。プライベートIPはスキップ |
| ④ | Spamhaus Domain | DNS `{domain}.dbl.spamhaus.org` | From アドレスのドメイン部分を使用 |
| ⑤ | ヒューリスティック | ハードコードパターン | 件名/本文の正規表現マッチ |
| ⑥ | ML | DB `ml_spam_model` | 後述 |

### IP抽出ロジック

`extractSenderIp()` がReceivedヘッダーを**末尾（最も信頼できるホップ）から**走査し、最初の外部IPを返す。`10.x`, `192.168.x`, `172.16-31.x`, `127.x`, `::1` はプライベートIPとして除外。

---

## 3. MLモデル（ComplementNB）

### 3-1. Naive Bayes の基礎

Naive Bayes はベイズの定理に基づくテキスト分類器。「各特徴量は互いに独立」という仮定（Naive）のもと、クラス事後確率を計算する。

$$P(c \mid x_1, \dots, x_n) \propto P(c) \prod_{i=1}^{n} P(x_i \mid c)$$

積のまま計算するとアンダーフローするため、対数を取って和に変換する：

$$\log P(c \mid \mathbf{x}) \propto \underbrace{\log P(c)}_{\text{クラス事前確率}} + \underbrace{\sum_{i=1}^{n} \log P(x_i \mid c)}_{\text{各トークンの対数尤度の和}}$$

全クラスについて計算し、スコアが最大のクラスを予測値とする：

$$\hat{c} = \arg\max_c \left[ \log P(c) + \sum_{i} \log P(x_i \mid c) \right]$$

---

### 3-2. MultinomialNB vs ComplementNB

通常の **Multinomial NB（MNB）** は各クラスのトークン確率を直接推定する（ラプラス平滑化 $\alpha=1$）：

$$\log P(t \mid \text{spam}) = \log \frac{\text{count}(t,\ \text{spam}) + \alpha}{\sum_{t'} \text{count}(t',\ \text{spam}) + \alpha \cdot |\mathcal{V}|}$$

クラス不均衡（spam 10件 vs ham 5000件）では spam の学習サンプルが少なく、スパムトークンの確率推定が粗くなる。

**Complement NB（CNB）** は逆の発想で、**補集合クラス（$\lnot c$）の確率**を使って判定する：

$$\log \tilde{P}(t \mid c) = \log \frac{\text{count}(t,\ \lnot c) + \alpha}{\sum_{t'} \text{count}(t',\ \lnot c) + \alpha \cdot |\mathcal{V}|}$$

予測はスコアが**最小**のクラス（補集合らしさが最も低い = 本クラスらしい）：

$$\hat{c} = \arg\min_c \sum_{i} \log \tilde{P}(x_i \mid c)$$

ham サンプルが多いほど「ham らしいトークン」の推定精度が上がり、スパムではないものを排除する判断が安定する。クラス不均衡に有利な理由はここにある。

実装（`scripts/train-spam-model.py`）：

```python
clf = ComplementNB(alpha=1.0)  # α=1.0 はラプラス平滑化
clf.fit(X, y)
# clf.feature_log_prob_: shape (n_classes, n_features) — CNB の補集合対数確率
```

---

### 3-3. 特徴量（文字トライグラム）

言語非依存の**文字3-gram**を使用。形態素解析不要で日本語・英語・混在に対応。

```
件名「詐欺メール」→ スペース除去 →「詐欺メール」
→ トライグラム: 詐欺メ, 欺メー, メール
→ プレフィックス付き: s:詐欺メ, s:欺メー, s:メール  (s: = subject)
→ ×2 重みのため2回追加: [s:詐欺メ, s:詐欺メ, s:欺メー, s:欺メー, ...]
```

| 特徴量 | プレフィックス | 重み | 対象文字数 |
|---|---|---|---|
| 送信元ドメイン | `d:` | ×3 | ドメイン全体 |
| 送信元メールアドレス | `e:` | ×1 | アドレス全体 |
| 送信者名 | `n:` | ×1 | 名前全体 |
| 件名トライグラム | `s:` | ×2 | 件名全体 |
| 本文トライグラム | `b:` | ×1 | 先頭300文字 |
| 添付あり | `has_attachment` | ×1 | boolean |

ドメインを3倍・件名を2倍にしているのは、これらがスパム判別上最も信頼性の高いシグナルであるため。

**語彙の絞り込み（min_df=2）**：2文書以上に出現するトークンのみを語彙に含める。1文書だけに出現するトークンはノイズになるため除外。

---

### 3-4. 学習ワークフロー

```
1. エクスポート
   GET /api/admin/spam-classifier/export
   → training-data.json（全スレッドにスパム/ham ラベル付き）

2. ローカル学習（要 Python + scikit-learn）
   python3 scripts/train-spam-model.py training-data.json model.json

3. アップロード
   PUT /api/admin/spam-classifier/model  ← model.json をアップロード
   （管理UIからも可能）

4. DB保存
   ml_spam_model テーブルに JSON を保存。5分 TTL でメモリキャッシュ。
```

モデルは以下の形式で DB に保存される：

```json
{
  "classes": ["spam", "ham"],
  "classLogPriors": [-4.05, -0.007],
  "featureLogProbs": {
    "d:gmail.com": [-3.2, -1.1],
    "s:詐欺メ":    [-1.5, -8.3]
  },
  "unknownLogProbs": [-12.4, -9.1],
  "vocabSize": 84231,
  "spamCount": 29,
  "hamCount": 5256
}
```

`classLogPriors[0]`（spam）は出現頻度が低いため大きな負の値。`featureLogProbs[token][ci]` は各トークン×クラスの対数確率。

---

### 3-5. 推論（runtime）

`src/lib/spam-classifier.ts` の `predict()` が実装。

```typescript
const logScores = classLogPriors.map((prior, ci) => {
  let score = prior;
  for (const token of tokens) {
    const probs = featureLogProbs[token];
    score += probs ? probs[ci] : unknownLogProbs[ci];  // OOV はスムージング値
  }
  return score;
});

const bestIdx   = logScores[0] >= logScores[1] ? 0 : 1;
const secondIdx = 1 - bestIdx;
const delta = logScores[bestIdx] - logScores[secondIdx];

return { label: classes[bestIdx], delta, n: tokens.length };
```

$\delta$（delta）はクラス間の log-odds 差：

$$\delta = s_{\text{best}} - s_{\text{second}}$$

$\delta > 0$ → best クラスが優勢。$\delta \approx 0$ → 判断微妙（五分五分）。

$n$ はトークン数（メール長に比例）。$\delta$ はメールが長いほど大きくなるため、**$\delta / n$（1トークンあたり平均 log-odds 差）** で正規化して閾値比較を行う：

```typescript
// detectSpam() での閾値比較（src/lib/spam.ts）
const deltaNormalized = mlResult.delta / mlResult.n;
if (deltaNormalized >= threshold) {  // SPAM_DELTA_THRESHOLD、デフォルト 0.5
  return { isSpam: true, reason: 'ml_model' };
}
```

実測値（`node prisma/eval-spam-ml.mjs`）：

| 件名 | $\delta$ | $n$ | $\delta/n$ |
|---|---|---|---|
| Chart株式会社 | 98.3 | 185 | 0.53 |
| 【ご確認の上、ご返信ください】 | 195.7 | 151 | 1.30 |
| 株式会社chArt | 252.9 | 186 | 1.36 |
| ＣＨＡＲＴ株式会社 | 262.9 | 161 | 1.63 |

デフォルト閾値 `0.5` で全件通過。閾値を `1.0` に上げると $\delta/n = 0.53$ のケースを除外（より保守的）。

---

### 3-6. sigmoid を使わない理由（歴史的経緯）

当初は信頼度 $\sigma(\delta)$ を返していたが、NB の独立性仮定により $\delta$ が極端に大きくなり **常に飽和** することが判明。

$$\sigma(\delta) = \frac{1}{1+e^{-\delta}} \qquad \delta > 37 \implies \sigma(\delta) = 1.0 \text{（float64 精度限界）}$$

$$\delta = \sum_{i=1}^{n} \bigl(\log P(x_i \mid \text{spam}) - \log P(x_i \mid \text{ham})\bigr)$$

件名トライグラム数十個で平均 log-odds 差が $0.5$ なら $\delta \approx 50 > 37$。現実の入力はほぼ全件 $\sigma = 1.0$ になるため、信頼度による閾値制御が不可能だった。

sigmoid を除去し $\delta / n$ を直接閾値比較することで、有効な閾値設定が可能になった。

実際の品質指標として有効なのは **正解率・適合率・再現率**（eval スクリプトで計測）。

---

### 3-7. アウトプットの形式と伝播経路

#### `predictSpam()` の返り値

```typescript
type SpamPrediction = { label: 'spam' | 'ham'; delta: number; n: number } | null;
```

| フィールド | 型 | 値の例 | 説明 |
|---|---|---|---|
| `label` | `'spam' \| 'ham'` | `'spam'` | 分類の主判定 |
| `delta` | `number` | `195.7` | クラス間 log-odds 差（正の実数） |
| `n` | `number` | `151` | トークン数（メール長） |

モデル未学習の場合は `null` を返す（ML ステップをスキップ）。

#### `detectSpam()` の返り値

```typescript
type SpamResult = { isSpam: true; reason: string } | null;
```

スパムでない場合は `null`。スパムの場合は `reason` に検出レイヤーを記録：

| `reason` | 検出レイヤー |
|---|---|
| `'blocklist'` | ブロックリスト一致 |
| `'spamhaus_ip'` | Spamhaus IP DNSBL |
| `'spamhaus_domain'` | Spamhaus Domain DNSBL |
| `'heuristic'` | キーワードマッチ |
| `'ml_model'` | ML 分類（本節） |
| `'manual'` | ユーザーが手動マーク（API 側でセット） |

#### 伝播経路

```
sync.ts: detectSpam()
    │
    ├─ null（スパムでない）
    │       └─ notifyNewMessage() を呼ぶ / スレッドそのまま
    │
    └─ { isSpam: true, reason }
            ├─ threads.update({ is_spam: true, spam_reason, spam_flagged_at })
            ├─ spam_senders.upsert（ブロックリスト自動追加、reason≠'blocklist' のみ）
            └─ notifyNewMessage() を呼ばない
```

---

### 3-8. 重み付けの変更方法（Python）

現在の重み付けは **トークンを繰り返す**ことで実現している（count matrix への直接的な効果）。

```python
# scripts/train-spam-model.py の build_tokens() — 現在の重み
tokens += [f"d:{domain}"] * 3   # ドメイン ×3
tokens.append(f"e:{from_email}") # メールアドレス ×1
tokens += [tri, tri]             # 件名トライグラム ×2（body は ×1）
```

> ⚠️ **`build_tokens()` は Python と TypeScript の2箇所に存在する。必ず両方同時に変更すること。**
>
> - `scripts/train-spam-model.py` — 学習時の特徴量抽出
> - `src/lib/spam-classifier.ts` の `buildFeatureTokens()` — 推論時の特徴量抽出
>
> 片方だけ変えると学習時と推論時で特徴空間がずれ、精度が著しく低下する。

#### ① トークン繰り返し数の変更

```python
# build_tokens() 内（両ファイルで同じ値にすること）
tokens += [f"d:{domain}"] * 5   # ドメイン ×5 に強化
tokens += [tri, tri, tri]        # 件名 ×3 に強化
```

繰り返しを増やすほど、そのフィールドが分類スコアに与える影響が大きくなる。ただし増やしすぎると他の特徴量を完全に無視するモデルになる。

#### ② スパムサンプルの sample_weight 強化

学習サンプル数の不均衡（spam 10件 vs ham 5000件）を `sample_weight` で補正する。

```python
# main() 内、clf.fit() の直前に追加
import numpy as np

spam_weight = len(ham_items) / len(spam_items)  # ≈ 500
weights = np.array(
    [spam_weight] * len(spam_items) + [1.0] * len(ham_items)
)
clf.fit(X, y, sample_weight=weights)
```

これにより spam 1件が ham 500件分の重みで学習される。**誤検知（ham を spam と判定）が増えるリスク**があるため、変更後は eval スクリプトで再確認すること。

#### ③ クラス事前確率の調整

```python
# ComplementNB は class_prior をサポートしていないため、
# classLogPriors を学習後に上書きする方法で対応

import math
spam_prior = 0.3  # 実際の出現率（0.005）より高く設定 → スパム寄りに偏らせる
ham_prior  = 1.0 - spam_prior

model["classLogPriors"] = [
    math.log(spam_prior),
    math.log(ham_prior)
]
```

事前確率を上げるとスパム判定が増え、誤検知も増える。下げると見逃しが増える。

#### 変更後の確認手順

```bash
# 1. 再学習
python3 scripts/train-spam-model.py training-data.json model.json

# 2. アップロード（管理UIまたはAPI）
curl -X PUT http://localhost:3000/api/admin/spam-classifier/model \
     -H "Cookie: <session>" \
     -F "model=@model.json"

# 3. 評価
node prisma/eval-spam-ml.mjs
# → 正解率・✗ の内訳を確認
```

---

### 3-9. 改善オプション

| 方法 | 内容 | delta/n 閾値への影響 |
|---|---|---|
| **Logistic Regression** | scikit-learn `LogisticRegression`。独立性仮定なし → 較正された確率が出る。`confidence` 復活も可 | 閾値設定の再キャリブレーションが必要 |
| **Platt Scaling** | NB の出力に sigmoid calibration をかける後処理 | 同上 |
| **サンプル増加** | spam 100件以上になると精度が向上し $\delta/n$ 分布が安定 | 閾値デフォルト見直しが必要になる可能性 |
| **$\delta/n$ 閾値のみ調整** | 現行実装。管理画面から変更可能 | 即効性あり |

---

## 4. ブロックリスト自動追加

スパム検出時、以下のタイミングでブロックリストに自動追加される（`spam_senders` テーブル）。

| トリガー | `created_by_id` | `note` |
|---|---|---|
| 受信時の自動検出（`blocklist` 以外の reason） | `null` | `ML自動判定` |
| ユーザーが「迷惑メール」ボタンを押す（スレッド内の**全 incoming 送信者**を登録） | そのユーザーのID | `手動マーク` |
| 管理者が手動で追加 | 管理者のID | 任意入力 |

「迷惑メールではない」（unspam）操作時は、そのスレッドの incoming 送信者に一致するブロックリスト行を削除する（誤マークした送信者が永久ブロックされるのを防ぐ）。

管理設定 > 迷惑メール管理 の「登録者」列では `created_by_id` が `null` のエントリを **「ML」** と表示する。

`upsert` なので重複追加はしない。すでにブロックリスト掲載済みの reason（`'blocklist'`）の場合は追加しない。

---

## 5. 同期時の処理フロー

`src/lib/mail/sync.ts` の受信メッセージ処理内：

```typescript
// 1. スレッドが既に is_spam なら継承（別アドレスからの追撃メールも通知させない）
const thread = await prisma.threads.findUnique({ where: { id: threadId }, select: { is_spam: true } });
if (thread?.is_spam) {
  isSpam = true;
} else {
  // 2. spam 検出
  const spamResult = await detectSpam({ fromEmail, receivedHeaders, subject, textBody, fromName, hasAttachments });

  if (spamResult?.isSpam) {
    // 3. スレッドにフラグを立てる
    await prisma.threads.update({ data: { is_spam: true, spam_reason, spam_flagged_at } });

    // 4. ブロックリスト追加（reason が 'blocklist' 以外のみ）
    await prisma.spam_senders.upsert({ ... created_by_id: undefined ... });
  }
}

// 5. スパムスレッドは通知しない
if (!isSpam) {
  await notifyNewMessage(...);
}
```

検出処理が例外を投げた場合は fail-open（同期は止めない）だが、`console.error` と同期エラー一覧に記録される。

---

## 6. UIと操作

### スレッド一覧

- 通常タブ（すべて・未読・担当中など）: `is_spam: false` でフィルタ → スパムは非表示
- **迷惑メールタブ**: `?spam=1` パラメータ → `is_spam: true` のみ表示
- 一括操作: 「迷惑メール」「迷惑メール解除」ボタンで複数スレッドを一括処理

### スレッド詳細

- `is_spam: false` のとき → **「迷惑メール」ボタン**（オレンジ）表示
- `is_spam: true` のとき → **「迷惑メールではない」ボタン**（グリーン）表示
- 「迷惑メール」ボタン押下 → スレッドをスパムフラグ ＋ 送信元をブロックリスト追加 → 一覧に戻る

### 管理設定 > 迷惑メール管理（4番目のタブ）

- **ブロックリスト**: このリストに登録されたアドレス/ドメインは自動スパム判定
- **ホワイトリスト**: Spamhaus・ML・ヒューリスティックすべてをスキップ
- 列: アドレス/ドメイン、メモ、登録者（null=ML）、日時、削除ボタン
- 追加フォーム: アドレス or ドメイン（例: `spam.com`）＋メモ

---

## 7. DB スキーマ

### `threads` テーブル（追加フィールド）

```sql
is_spam          BOOLEAN NOT NULL DEFAULT false
spam_reason      TEXT    -- 'blocklist' | 'spamhaus_ip' | 'spamhaus_domain' | 'heuristic' | 'ml_model' | 'manual'
spam_flagged_at  TIMESTAMP
```

### `spam_senders` テーブル

```sql
id             TEXT PRIMARY KEY
type           TEXT  -- 'whitelist' | 'blocklist'
address        TEXT  -- メールアドレス or ドメイン（小文字）
note           TEXT  -- 任意メモ
created_by_id  TEXT  -- users.id の外部キー（NULL = システム自動）
created_at     TIMESTAMP

UNIQUE(type, address)
```

### `ml_spam_model` テーブル

```sql
id          TEXT PRIMARY KEY
model_data  TEXT  -- JSON（featureLogProbs, classLogPriors など）
trained_at  TIMESTAMP
spam_count  INT
ham_count   INT
version     TEXT
```

---

## 8. APIエンドポイント

| Method | Path | 説明 |
|---|---|---|
| GET | `/api/threads?spam=1` | 迷惑メールスレッド一覧 |
| POST | `/api/threads/[id]/spam` | 手動スパムマーク ＋ ブロックリスト追加 |
| POST | `/api/threads/[id]/unspam` | スパム解除 |
| POST | `/api/threads/bulk` (action=spam) | 一括スパムマーク |
| POST | `/api/threads/bulk` (action=unspam) | 一括スパム解除 |
| GET | `/api/admin/spam-senders` | ホワイトリスト/ブロックリスト一覧 |
| POST | `/api/admin/spam-senders` | エントリ追加（管理者のみ） |
| DELETE | `/api/admin/spam-senders/[id]` | エントリ削除（管理者のみ） |
| GET | `/api/admin/spam-classifier/export` | 学習データエクスポート |
| PUT | `/api/admin/spam-classifier/model` | モデルアップロード |

---

## 9. 設定

`管理設定 > システム設定` から変更可能。

| キー | デフォルト | 説明 |
|---|---|---|
| `SPAM_DELTA_THRESHOLD` | `0.5` | ML判定の閾値（$\delta/n$）。大きいほど保守的（誤検知が減る）。`node prisma/eval-spam-ml.mjs` で実測値を確認して調整 |

---

## 10. 既知の制限と改善案

### 閾値チューニング

- `SPAM_DELTA_THRESHOLD`（デフォルト `0.5`）を調整することで誤検知率をコントロールできる
- **誤検知が多い（ham をスパム判定）**: 閾値を上げる（例: `1.0`、`2.0`）
- **見逃しが多い（スパムを通過）**: 閾値を下げる（例: `0.3`）
- `node prisma/eval-spam-ml.mjs` で現在の $\delta/n$ 分布を確認してから調整すること
- 特定の送信元だけ問題なら、閾値変更より**ホワイトリスト追加**（管理設定 > 迷惑メール）が即効性が高い

### 学習データ不足

- 現状: spam 約10件 / ham 約5000件
- 推奨: spam 最低100件以上で安定した精度に
- ham が圧倒的多数のため ComplementNB を使用（通常の MultinomialNB より不均衡に強い）

### 手動マーク ≠ 真のスパム

手動で迷惑メール登録した中に「迷惑ではないが不要なメール（営業）」が混在しやすい。MLモデルはこれを学習するため精度に悪影響が出る。評価スクリプト（`prisma/eval-spam-ml.mjs`）で定期的に確認すること。

### Spamhausの利用条件

- 自社ネットワーク（オフィス・自宅サーバー）からの実行は無料・トークン不要
- クラウド（AWS/GCP/VPS）のIPからの大量クエリは利用規約違反になる場合あり
- API token（有料）を取得すれば商用クラウドからも利用可能

---

## 11. ファイル一覧

| ファイル | 役割 |
|---|---|
| `src/lib/spam.ts` | 検出パイプライン本体 |
| `src/lib/spam-classifier.ts` | MLモデルのロード・推論・学習データ取得 |
| `src/lib/mail/sync.ts` | 受信時に detectSpam() を呼び出す |
| `scripts/train-spam-model.py` | ローカル学習スクリプト（Python / scikit-learn） |
| `prisma/eval-spam-ml.mjs` | モデル精度評価スクリプト |
| `src/app/api/threads/[id]/spam/route.ts` | 手動スパムマーク API |
| `src/app/api/threads/[id]/unspam/route.ts` | スパム解除 API |
| `src/app/api/admin/spam-senders/route.ts` | ホワイトリスト/ブロックリスト CRUD |
| `src/app/api/admin/spam-classifier/` | MLモデルエクスポート・アップロード |
