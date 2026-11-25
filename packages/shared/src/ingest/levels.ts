export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const ALIASES: Readonly<Record<string, LogLevel>> = {
  trace: 'trace',
  verbose: 'trace',
  debug: 'debug',
  dbg: 'debug',
  info: 'info',
  information: 'info',
  notice: 'info',
  warn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  alert: 'fatal',
  emergency: 'fatal',
  emerg: 'fatal',
  panic: 'fatal',
};

/** Pino/bunyan-style numeric levels. */
const NUMERIC: readonly [number, LogLevel][] = [
  [60, 'fatal'],
  [50, 'error'],
  [40, 'warn'],
  [30, 'info'],
  [20, 'debug'],
  [0, 'trace'],
];

/** Maps free-form level values (strings or pino numbers) onto the canonical set; defaults to info. */
export function normalizeLevel(value: unknown): LogLevel {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return (NUMERIC.find(([min]) => value >= min)?.[1] ?? 'trace') as LogLevel;
  }
  if (typeof value === 'string') return ALIASES[value.trim().toLowerCase()] ?? 'info';
  return 'info';
}
