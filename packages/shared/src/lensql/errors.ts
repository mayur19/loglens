/** Character span inside the original query text (start inclusive, end exclusive). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export type LensQLErrorCode =
  'LEX_ERROR' | 'PARSE_ERROR' | 'SEMANTIC_ERROR' | 'LIMIT_EXCEEDED' | 'TIME_RANGE_ERROR';

/**
 * Every failure in the LensQL pipeline is reported as a LensQLError carrying the
 * offending span so the UI can underline the exact token.
 */
export class LensQLError extends Error {
  readonly code: LensQLErrorCode;
  readonly span: Span;

  constructor(code: LensQLErrorCode, message: string, span: Span) {
    super(message);
    this.name = 'LensQLError';
    this.code = code;
    this.span = span;
  }

  toJSON(): { code: LensQLErrorCode; message: string; span: Span } {
    return { code: this.code, message: this.message, span: this.span };
  }
}

export const spanOf = (start: number, end: number): Span => ({ start, end });

export const mergeSpans = (a: Span, b: Span): Span => ({
  start: Math.min(a.start, b.start),
  end: Math.max(a.end, b.end),
});
