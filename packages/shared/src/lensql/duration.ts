import { LensQLError, type Span } from './errors.js';

const UNIT_SECONDS: Readonly<Record<string, number>> = {
  s: 1,
  sec: 1,
  m: 60,
  min: 60,
  h: 3600,
  d: 86400,
  w: 604800,
};

const DURATION_RE = /^(\d{1,6})(s|sec|m|min|h|d|w)$/;
const RELATIVE_RE = /^-(\d{1,6})(s|sec|m|min|h|d|w)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Parses `30s`, `5m`, `1h`, `7d` into seconds. Returns null when the text is not a duration. */
export function parseDurationSeconds(text: string): number | null {
  const match = DURATION_RE.exec(text);
  if (!match) return null;
  const unit = UNIT_SECONDS[match[2] as string] as number;
  return Number(match[1]) * unit;
}

/**
 * Resolves a LensQL time expression (`now`, `-15m`, `2026-01-31T10:00:00Z`) relative to `now`.
 * Throws a TIME_RANGE_ERROR with the given span when the expression is not understood.
 */
export function resolveTimeExpression(text: string, now: Date, span: Span): Date {
  if (text.toLowerCase() === 'now') return new Date(now.getTime());
  const relative = RELATIVE_RE.exec(text);
  if (relative) {
    const unit = UNIT_SECONDS[relative[2] as string] as number;
    return new Date(now.getTime() - Number(relative[1]) * unit * 1000);
  }
  if (ISO_RE.test(text)) {
    const parsed = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  throw new LensQLError(
    'TIME_RANGE_ERROR',
    `Cannot interpret time '${text}'; use now, -15m, -2h, -7d or an ISO-8601 timestamp`,
    span,
  );
}
