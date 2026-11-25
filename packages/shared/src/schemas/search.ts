import { z } from 'zod';
import { LENSQL_LIMITS } from '../lensql/limits.js';

const isoDate = z.string().datetime({ offset: true });

export const searchRequestSchema = z
  .object({
    query: z.string().max(LENSQL_LIMITS.maxQueryLength).default(''),
    from: isoDate.optional(),
    to: isoDate.optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export const histogramRequestSchema = z
  .object({
    query: z.string().max(LENSQL_LIMITS.maxQueryLength).default(''),
    from: isoDate.optional(),
    to: isoDate.optional(),
    buckets: z.number().int().min(1).max(500).optional(),
  })
  .strict();
export type HistogramRequest = z.infer<typeof histogramRequestSchema>;

export const validateRequestSchema = z
  .object({ query: z.string().max(LENSQL_LIMITS.maxQueryLength) })
  .strict();

export const TIME_PRESETS = [
  { id: '15m', label: 'Last 15 minutes', seconds: 900 },
  { id: '1h', label: 'Last hour', seconds: 3600 },
  { id: '4h', label: 'Last 4 hours', seconds: 14400 },
  { id: '24h', label: 'Last 24 hours', seconds: 86400 },
  { id: '7d', label: 'Last 7 days', seconds: 604800 },
] as const;
