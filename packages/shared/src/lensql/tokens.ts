import type { Span } from './errors.js';

export type TokenType =
  'LPAREN' | 'RPAREN' | 'PIPE' | 'COMMA' | 'OP' | 'STRING' | 'NUMBER' | 'WORD' | 'EOF';

export type ComparisonOp = '=' | '!=' | '>' | '>=' | '<' | '<=' | '=~' | '!~';

export interface Token {
  readonly type: TokenType;
  /** Raw source text for WORD/NUMBER/OP, decoded value for STRING. */
  readonly value: string;
  readonly span: Span;
}

export const KEYWORDS = Object.freeze(['and', 'or', 'not', 'in', 'by', 'as'] as const);

export const isKeyword = (token: Token, keyword: string): boolean =>
  token.type === 'WORD' && token.value.toLowerCase() === keyword;
