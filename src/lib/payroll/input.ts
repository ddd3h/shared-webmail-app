// 控除の登録の、API が受け取る形（Next.js の route.ts からは、HTTP メソッド以外を export できないので別ファイル）。
import { z } from 'zod';
import { isValidDateString, jstDateString } from '@/lib/work';

const yen = z.number().int().min(0).max(10_000_000);

export const profileSchema = z.object({
  birth_date: z.string().refine(isValidDateString).refine(d => d >= '1900-01-01' && d <= jstDateString(new Date()), 'birth_date_range').nullable(),
  health_insured: z.boolean(),
  employment_insured: z.boolean(),
  standard_monthly: z.number().int().min(1).max(5_000_000).nullable(),
  dependents: z.number().int().min(0).max(20),
  resident_tax: yen,
  resident_tax_first: yen.nullable(),
  withholding_class: z.enum(['ko', 'otsu']).optional(), // 税額表: 甲欄（主たる給与）／乙欄（従たる給与）。ユーザーの設定を更新する
});

export const estimateSchema = z.object({
  user_id: z.string().min(1),
  month: z.string().refine(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)),
  earnings_total: z.number().int().min(0).max(1_000_000_000).optional(), // 省くと、その月の固定報酬と加算から
  nontaxable: z.number().int().min(0).max(1_000_000_000).optional(),
});
