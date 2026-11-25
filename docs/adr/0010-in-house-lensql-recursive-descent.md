# ADR-0010: In-house LensQL with a hand-written recursive-descent parser

- **Status:** Accepted
- **Date:** 2026-11-21
- **Related:** ADR-0011, ADR-0013, LG-020, LG-021, LG-022

## Context

Users need a compact, Splunk-like language: free text, `field=value`, boolean logic, regex, time bounds and a pipeline (`| stats count() by service span=5m | sort -count | head 5`). Exposing raw SQL is unsafe and unfriendly. Error messages must point at the exact offending characters so the UI can underline them.

## Decision Drivers

- Precise error spans and helpful messages ("Unknown aggregate 'median'; expected one of ...").
- Hard resource limits enforced while lexing/parsing (length, tokens, nesting).
- No runtime dependency with its own parsing quirks; shareable between API and browser.
- Grammar is small (about 20 productions) and will grow with `rex`, `eval`, `timechart` (LG-131..133).

## Considered Options

1. **Hand-written lexer + recursive-descent parser** in `packages/shared/src/lensql/`.
2. **Parser generator (PEG.js/peggy, nearley, ANTLR)** — declarative grammar, but emitted parser code, an extra build step, generic error messages and harder custom limits.
3. **Embed an existing language (KQL/SPL subset, Lucene syntax)** — familiar to some users, but incompatible semantics and licensing/compatibility expectations we cannot meet fully.

## Decision Outcome

Chosen option 1. Structure:

- `lexer.ts` — single pass, O(n); tokens `WORD`, `NUMBER`, `STRING` (with `\" \\ \n \t` escapes, NUL rejected), `OP` (longest match: `!= >= <= =~ !~` before `= > <`), `LPAREN`, `RPAREN`, `PIPE`, `COMMA`, `EOF`; barewords may contain `. - * : / @` so `api-*`, `http.status`, ISO timestamps and `-15m` lex as one token.
- `parser-expr.ts` — `expr := and (OR and)*`, `and := not ([AND] not)*` (implicit AND), `not := NOT not | primary`, `primary := '(' expr ')' | field op value | field IN (list) | text`. A `Cursor` class tracks position and nesting depth (max 32).
- `parser-commands.ts` — `stats`, `sort`, `head`, `fields`, `where`.
- `parser.ts` — lifts top-level `earliest=`/`latest=` out of the AND chain and rejects them inside `OR`/`NOT`/`where`.
- `analyzer.ts` — splits the pipeline into pre- and post-aggregation stages and enforces ordering rules.

Every AST node carries a `{start, end}` span; failures raise `LensQLError(code, message, span)` with codes `LEX_ERROR`, `PARSE_ERROR`, `SEMANTIC_ERROR`, `LIMIT_EXCEEDED`, `TIME_RANGE_ERROR`.

## Consequences

- **Positive:** linear-time parsing; errors such as `level=error | bogus` report span 14–19, which the UI underlines (`QueryError.tsx`); the same parser powers `/search/validate` for as-you-type feedback.
- **Positive:** 60+ parser and lexer tests document the grammar precisely.
- **Negative:** grammar changes require code, not a grammar file; mitigated by keeping productions one function each.
