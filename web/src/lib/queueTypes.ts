import { z } from 'zod';

/** One queued mutation awaiting replay (§4.7). */
export const queueEntrySchema = z.object({
  clientId: z.string().min(1),
  method: z.enum(['POST', 'PATCH', 'DELETE', 'PUT']),
  path: z.string().min(1),
  body: z.unknown().optional(),
  createdAt: z.number().int().nonnegative(),
});

export type QueueEntry = z.infer<typeof queueEntrySchema>;
