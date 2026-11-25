import { api } from '../../api/client';

export interface SearchColumn {
  readonly name: string;
  readonly type: 'time' | 'text' | 'number';
}

export interface SearchResponse {
  readonly mode: 'events' | 'table';
  readonly columns: readonly SearchColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly range: { readonly from: string; readonly to: string };
  readonly stats: {
    readonly rowCount: number;
    readonly limit: number;
    readonly truncated: boolean;
    readonly elapsedMs: number;
  };
}

export interface HistogramResponse {
  readonly bucketSeconds: number;
  readonly buckets: readonly { readonly start: string; readonly count: number }[];
  readonly total: number;
}

export interface SearchParams {
  readonly query: string;
  readonly from: string;
  readonly to: string;
}

export const runSearch = (p: SearchParams) => api.post<SearchResponse>('/api/v1/search', p);
export const runHistogram = (p: SearchParams) =>
  api.post<HistogramResponse>('/api/v1/search/histogram', { ...p, buckets: 60 });
