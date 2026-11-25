-- The finance-only notice "…確認してから振込に進んでください。" was stored in the payslip's own note, so the worker saw it on
-- their own statement and it never went away. It is now shown on the admin screen only, while the statement is still planned and
-- not in a 全銀 file (autoDraftNotice in src/lib/fixed-pay.ts). Take the stored sentences out; anything else in the note
-- (what finance wrote, the 【自動計算】 section) stays.
UPDATE "payslips"
SET "note" = NULLIF(BTRIM(
  REPLACE(REPLACE(REPLACE("note",
    'オートフローが、登録された固定報酬から自動で作った下書きです。控除（源泉所得税など）を確認してから振込に進んでください。', ''),
    'オートフローが、登録された固定報酬から自動で作った下書きです。控除は自動計算した概算です。確認してから振込に進んでください。', ''),
    '賞与として登録された支払いです。控除（源泉所得税など）は自動では入りません。確認してから振込に進んでください。', ''),
  E' \n\r\t'), '')
WHERE "note" LIKE '%確認してから振込に進んでください。%';
