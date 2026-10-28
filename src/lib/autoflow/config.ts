// オートフローの設定（app_settings の AUTOFLOW_CONFIG に JSON で保存）。どの流れも、最初は OFF。
import { z } from 'zod';

const days = (lo: number, hi: number, dflt: number) => z.number().int().min(lo).max(hi).default(dflt);

export const configSchema = z.object({
  // 業務報告書: 締め日の前日・当日・提出期限日に、まだ出していない人へ
  report: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  // 経費: 申請期限の N 日前と当日に、承認待ち・差戻し/却下がある人へ（承認待ちは承認者にも）
  expense: z.object({ enabled: z.boolean().default(false), days_before: days(1, 14, 3) }).default({ enabled: false, days_before: 3 }),
  // 振込日: N 日前と当日に、経理と管理者へ
  payment: z.object({ enabled: z.boolean().default(false), days_before: days(1, 14, 3) }).default({ enabled: false, days_before: 3 }),
  // 役員報酬・準業務委託の固定の月額から、毎月の締め日に給与明細(支払予定)の下書きを自動で作る
  fixed_pay: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  // 準業務委託の報告書: 提出する日を含む直近 N 日にログインがなければ、提出前に警告を出す
  activity: z.object({ enabled: z.boolean().default(false), days: days(3, 60, 14) }).default({ enabled: false, days: 14 }),
});

export type AutoflowConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: AutoflowConfig = configSchema.parse({});

/** 保存された文字列を設定にする。壊れていたり空だったりしたら、すべて OFF の既定値。 */
export function parseConfig(raw: string | null | undefined): AutoflowConfig {
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = configSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
