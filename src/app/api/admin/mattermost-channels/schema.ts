import { z } from 'zod';

export const channelSchema = z.object({
  channel_id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  visibility: z.enum(['public', 'private']),
  sort_order: z.number().int().min(0).max(9999).optional(),
  user_ids: z.array(z.string().min(1)).max(500).optional(),
});
