/** Hard guard rails applied by the LensQL front end. Kept in one place so docs and tests agree. */
export const LENSQL_LIMITS = Object.freeze({
  maxQueryLength: 4000,
  maxTokens: 512,
  maxDepth: 32,
  maxStringLength: 1024,
  maxRegexLength: 256,
  maxInValues: 100,
  maxAggregations: 10,
  maxGroupByFields: 5,
  maxFieldsProjection: 25,
  maxFieldNameLength: 128,
  maxPathSegments: 8,
  maxHead: 10000,
  maxStatsBuckets: 10000,
  minSpanSeconds: 1,
});
