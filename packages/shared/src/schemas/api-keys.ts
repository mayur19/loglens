import { z } from 'zod';

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    defaultService: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export interface ApiKeySummary {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly defaultService: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}
