import { z } from 'zod';
import { isValidDateString } from '@/lib/work';
import { MAX_SCORE, MIN_SCORE } from '@/lib/org';

const comment = z.string().trim().max(2000).nullish().transform(v => v || null);

export const cycleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  period_start: z.string().refine(isValidDateString),
  period_end: z.string().refine(isValidDateString),
  criteria: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(500).nullish().transform(v => v || null),
    weight: z.number().int().min(1).max(10),
  })).min(1).max(20),
}).refine(c => c.period_start <= c.period_end, { message: 'period_order' });

export const formSchema = z.object({
  scores: z.array(z.object({
    criterion_id: z.string().min(1),
    score: z.number().int().min(MIN_SCORE).max(MAX_SCORE).nullable(),
    comment,
  })).max(20),
  comment,
  submit: z.boolean().default(false),
});

export const finalizeSchema = z.object({
  grade: z.enum(['S', 'A', 'B', 'C', 'D']).optional(),
  final_comment: comment,
});
