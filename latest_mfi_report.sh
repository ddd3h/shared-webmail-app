#!/bin/bash

# .env を読み込む
set -a
source .env
set +a

# psql 用に ?schema=public を除去
PSQL_DATABASE_URL=$(echo "$DATABASE_URL" | sed 's/[?]schema=.*//')

# クエリ実行
psql "$PSQL_DATABASE_URL" -c "
SELECT
  u.name,
  u.email,
  ROUND(s.mfi::numeric, 1) AS mfi,
  ROUND(s.debt::numeric, 1) AS debt,
  s.recorded_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo' AS recorded_at_jst
FROM mfi_snapshots s
JOIN users u ON u.id = s.user_id
WHERE s.recorded_at = (
  SELECT MAX(recorded_at)
  FROM mfi_snapshots
  WHERE user_id = s.user_id
)
ORDER BY s.mfi ASC;
"
