# 下書き保存機能

> 最終更新: 2026-05-18

---

## 概要

メール作成フォーム（`ComposeForm`）で入力中の内容を自動的にDBへ保存し、ブラウザを閉じても再開できる機能。  
デバウンス方式により、入力が止まってから1秒後にサーバーへ保存する。

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `src/hooks/useDraft.ts` | 保存ロジック（デバウンス・API呼び出し・状態管理） |
| `src/components/ComposeForm.tsx` | UIからuseDraftを呼び出す |
| `src/components/DraftStatus.tsx` | 保存状態のステータスバー表示 |
| `src/app/api/drafts/route.ts` | GET（一覧）・POST（新規作成） |
| `src/app/api/drafts/[id]/route.ts` | GET（取得）・PUT（更新）・DELETE（削除） |

---

## 保存フロー

```
ユーザーが入力（宛先・件名・本文）
         ↓
saveDraft() — ComposeForm内
  現在のフィールド値（to/cc/bcc/subject/html_body/mailbox_id）を収集
         ↓
scheduleSave(data) — useDraft
  pendingRef.current = data   ← 最新データを上書き保持
  既存タイマーをクリア
  1000ms タイマーをセット
         ↓ (1秒間入力がなければ発火)
saveNow(data) — useDraft
  savingRef.current = true   ← 多重実行ブロック
  ┌ draftId なし → POST /api/drafts   → 新規作成 → draftId を state に保存
  └ draftId あり → PUT  /api/drafts/{id} → 上書き更新
  成功: status='saved', savedAt=現在時刻
  失敗: status='error'
  finally: savingRef.current = false
```

**デバウンス1000ms** が核心。連続入力中はタイマーが毎回リセットされるため、入力が止まった1秒後だけ実際のネットワーク通信が発生する。

---

## 初期ロード（下書き再開）

`ComposeForm` に `draftId` prop が渡された場合、マウント時に下書きを復元する。

```
マウント + draftId あり
         ↓
GET /api/drafts/{id}
         ↓
to_raw   → toChips 配列に変換・セット
cc_raw   → ccChips 配列に変換・セット
bcc_raw  → bccChips 配列に変換・セット
subject  → subject state にセット
mailbox_id → selectedMailbox にセット
html_body → エディタに流し込み（richContentRef も更新）
```

---

## 送信後の削除

```
onSend() 成功
         ↓
deleteDraft() → DELETE /api/drafts/{id}
draftId = null, status = 'idle'
         ↓
連絡先未登録チェック → onCancel() でフォームを閉じる
```

---

## コラボ編集モード（チームメール）

チームメールボックスで返信・作成する場合、Yjs による共有編集（WebSocket）が有効になる。  
このとき本文はコラボエンジンが管理するため、下書き保存から本文フィールドを除外する。

| 状態 | 保存される内容 |
|---|---|
| `inCollab = false` | to/cc/bcc/subject/html_body/text_body/mailbox_id |
| `inCollab = true` | to/cc/bcc/subject/mailbox_id のみ（本文除外） |

コラボがアクティブになった瞬間、デバウンス待ち中の `pendingRef` からも本文フィールドを削除する（`stripBodyFromPending()`）。

---

## 状態一覧（DraftStatus）

| status | 意味 |
|---|---|
| `idle` | 未保存・入力待ち |
| `saving` | 保存中（API通信中） |
| `saved` | 保存完了（`savedAt` に時刻が入る） |
| `error` | 保存失敗 |

---

## 既知のバグ・課題

| 重大度 | 場所 | 内容 |
|---|---|---|
| 高 | `ComposeForm.tsx:201` | 送信成功後の `deleteDraft()` が連絡先確認ダイアログより先に実行されるが、送信は成功済みのため実害なし（許容） |
| 中 | `useDraft.ts:70` | 高速入力時に `pendingRef` が上書きされ続け、中間の変更がサーバーに届かない可能性がある（デバウンス仕様上の許容範囲） |
| 低 | `useDraft.ts` | PUT レスポンスに更新後の body が含まれないが、フロントは使用していないため実害なし |
