/**
 * Pure RPC-param narrowing helpers used by the router.
 *
 * Split out of `router.ts` so they can be unit-tested directly: `router.ts`
 * imports `vscode`, which vitest cannot resolve outside the extension host,
 * so nothing exported from that file is importable from a unit test. This
 * file imports nothing — no `vscode`, no `react` — and never will.
 */

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Narrows the `date` param for `setDue`.
 *
 * An empty string is valid and meaningful — it is bd's documented way to
 * clear a due date — which is exactly why this cannot reuse `requireString`
 * (that helper rejects blank strings outright). Anything else must be a
 * `YYYY-MM-DD` date; a free-form string would otherwise reach the `bd` argv
 * unvalidated, and `setDue` is the first mutation in this codebase whose
 * parameter is not drawn from a fixed vocabulary.
 */
export function requireDueDate(value: unknown, field: string): string {
  if (typeof value === 'string' && (value === '' || DUE_DATE_PATTERN.test(value))) {
    return value;
  }
  throw new Error(`Invalid parameter "${field}": expected a YYYY-MM-DD date or an empty string.`);
}
