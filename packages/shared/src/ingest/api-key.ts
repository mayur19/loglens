/**
 * Ingestion API keys look like `llk_<8 char prefix>_<43 char secret>`. The prefix is stored in
 * clear text for lookup and display; only a SHA-256 hash of the full token is persisted.
 */
const API_KEY_RE = /^llk_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

export interface ParsedApiKey {
  readonly prefix: string;
  readonly token: string;
}

export function parseApiKey(token: string): ParsedApiKey | null {
  const match = API_KEY_RE.exec(token.trim());
  return match ? { prefix: match[1] as string, token: token.trim() } : null;
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}
