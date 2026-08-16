import { z } from 'zod';
import type { DogfoodActivitySnapshot } from './activity-store';

const dogfoodActivityRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start-dogfood-collection') }).strict(),
  z.object({ type: z.literal('pause-dogfood-collection') }).strict(),
  z.object({ type: z.literal('get-dogfood-activity') }).strict(),
  z.object({ type: z.literal('record-dogfood-selection') }).strict(),
  z
    .object({
      type: z.literal('record-dogfood-pronunciation'),
      variety: z.enum(['en-US', 'en-GB']),
      sentenceCount: z.number().int().positive(),
    })
    .strict(),
]);

export type DogfoodActivityRequest = z.infer<
  typeof dogfoodActivityRequestSchema
>;
export type DogfoodActivityResponse =
  | { status: 'loaded'; snapshot: DogfoodActivitySnapshot | null }
  | { status: 'recorded' | 'ignored' }
  | { status: 'failed'; message: string };

export function parseDogfoodActivityRequest(
  value: unknown,
): DogfoodActivityRequest {
  return dogfoodActivityRequestSchema.parse(value);
}
