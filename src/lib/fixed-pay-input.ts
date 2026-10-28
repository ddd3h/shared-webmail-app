// 固定報酬・加算・賞与の、API が受け取る形（Next.js の route.ts からは、HTTP メソッド以外を export できないので別ファイル）。
import { z } from 'zod';
import { isBonusTitle, isValidMonth } from '@/lib/work';

const month = z.string().refine(isValidMonth);

export const planSchema = z.object({
  user_id: z.string().min(1),
  label: z.string().trim().min(1).max(40).refine(l => !isBonusTitle(l), 'bonus_label'), // 「賞与」は加算・賞与の欄で登録する
  amount: z.number().int().min(1).max(100_000_000),
  starts_month: month,
  ends_month: month.nullable().optional(),
  active: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).refine(p => !p.ends_month || p.ends_month >= p.starts_month, { message: 'ends_before_starts' });

export const extraSchema = z.object({
  user_id: z.string().min(1),
  pay_month: month,
  kind: z.enum(['addon', 'bonus']),
  label: z.string().trim().min(1).max(40),
  amount: z.number().int().min(1).max(100_000_000),
});
