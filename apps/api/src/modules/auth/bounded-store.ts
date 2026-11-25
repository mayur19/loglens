export interface Expiring {
  readonly expiresAt: number;
}

export interface WarnLogger {
  warn(obj: object, msg: string): void;
}

/**
 * Size-bounded in-memory map for limiter state. When full it first sweeps expired entries with a
 * resumable cursor (so repeated sweeps eventually cover the whole map instead of rescanning the
 * oldest keys), and only if every entry is still active does it evict the one with the least
 * time left, logging a warning. It never refuses new keys, so filling the store cannot lock out
 * unrelated users. Single-process only: see ADR-0008 and LG-216 for the Postgres-backed successor.
 */
export class BoundedStore<V extends Expiring> {
  private readonly map = new Map<string, V>();
  private cursor: Iterator<string> | null = null;

  constructor(
    private readonly maxEntries: number,
    private readonly logger: WarnLogger,
    private readonly label: string,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1)
      throw new Error('maxEntries must be a positive integer');
  }

  get size(): number {
    return this.map.size;
  }

  get(key: string, now: number): V | undefined {
    const value = this.map.get(key);
    if (value && value.expiresAt <= now) {
      this.map.delete(key);
      return undefined;
    }
    return value;
  }

  set(key: string, value: V, now: number): void {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) this.makeRoom(now);
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  private nextKey(): string | undefined {
    if (!this.cursor) this.cursor = this.map.keys();
    let step = this.cursor.next();
    if (step.done) {
      this.cursor = this.map.keys();
      step = this.cursor.next();
    }
    return step.done ? undefined : step.value;
  }

  private makeRoom(now: number): void {
    const budget = this.map.size;
    for (let scanned = 0; scanned < budget && this.map.size >= this.maxEntries; scanned += 1) {
      const key = this.nextKey();
      if (key === undefined) break;
      const value = this.map.get(key);
      if (value && value.expiresAt <= now) this.map.delete(key);
    }
    if (this.map.size < this.maxEntries) return;
    let victim: string | undefined;
    let least = Number.POSITIVE_INFINITY;
    for (const [key, value] of this.map) {
      if (value.expiresAt < least) {
        least = value.expiresAt;
        victim = key;
      }
    }
    if (victim !== undefined) {
      this.map.delete(victim);
      this.logger.warn(
        { store: this.label, size: this.map.size + 1, remainingMs: least - now },
        'limiter store full of active entries; evicted the entry closest to expiry',
      );
    }
  }
}
