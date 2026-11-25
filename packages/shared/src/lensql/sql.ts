/**
 * Immutable SQL fragments. Fragment text only ever contains compiler-owned constants and
 * `$?` placeholders; every user-supplied value travels in `params`. `finalizeSql` numbers the
 * placeholders so fragments can be composed without tracking indexes.
 */
export interface SqlFragment {
  readonly text: string;
  readonly params: readonly unknown[];
}

export const PLACEHOLDER = '$?';

export const sql = (text: string, params: readonly unknown[] = []): SqlFragment => {
  const expected = text.split(PLACEHOLDER).length - 1;
  if (expected !== params.length) {
    throw new Error(`SQL fragment expects ${expected} params but received ${params.length}`);
  }
  return { text, params };
};

export const joinSql = (parts: readonly SqlFragment[], separator: string): SqlFragment => ({
  text: parts.map((p) => p.text).join(separator),
  params: parts.flatMap((p) => p.params),
});

/** Builds a fragment from a template where each `{}` slot is filled with a sub-fragment. */
export const composeSql = (template: string, ...parts: readonly SqlFragment[]): SqlFragment => {
  const pieces = template.split('{}');
  if (pieces.length - 1 !== parts.length) {
    throw new Error(`Template expects ${pieces.length - 1} fragments but received ${parts.length}`);
  }
  const text = pieces.reduce((acc, piece, i) => acc + piece + (parts[i]?.text ?? ''), '');
  return { text, params: parts.flatMap((p) => p.params) };
};

export interface FinalSql {
  readonly text: string;
  readonly values: readonly unknown[];
}

export const finalizeSql = (fragment: SqlFragment): FinalSql => {
  let index = 0;
  const text = fragment.text.replaceAll(PLACEHOLDER, () => {
    index += 1;
    return `$${index}`;
  });
  return { text, values: [...fragment.params] };
};

/** Escapes LIKE metacharacters and turns LensQL `*` wildcards into `%`. */
export const likePattern = (value: string, contains: boolean): string => {
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`).replaceAll('*', '%');
  return contains ? `%${escaped}%` : escaped;
};
