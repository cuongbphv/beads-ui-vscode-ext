/**
 * Pure RPC-param narrowing helpers used by the router.
 *
 * Split out of `router.ts` so they can be unit-tested directly: `router.ts`
 * imports `vscode`, which vitest cannot resolve outside the extension host,
 * so nothing exported from that file is importable from a unit test. This
 * file imports nothing at runtime — no `vscode`, no `react` — and never
 * will; the one `import type` below is erased at compile time.
 */
import type { CreateBeadParams, TextField } from '../../shared/protocol';

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

/**
 * A transcript target id is used to build a path under `~/.claude/projects`
 * (real wiring lands in a later Fleet bead); it must never carry path
 * separators, spaces, or `..` segments, so this is checked against an
 * allowlist rather than merely requiring a non-blank string.
 */
const TARGET_ID_PATTERN = /^[A-Za-z0-9:._-]+$/;

export function requireTargetId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required parameter "${field}".`);
  }
  if (!TARGET_ID_PATTERN.test(value)) {
    throw new Error(`Invalid parameter "${field}": expected only letters, digits, ':', '.', '_', '-'.`);
  }
  return value;
}

/**
 * `updateText`'s allowlist of settable fields. This is CLI shape, not beads
 * vocabulary — the fixed set of dedicated `bd update` flags — so hardcoding
 * it here (unlike `type`/`priority`/`status` elsewhere in this file) is
 * correct: there is no runtime source of truth to defer to.
 */
const TEXT_FIELDS: readonly TextField[] = ['title', 'description', 'design', 'acceptance', 'notes'];

export function requireTextField(value: unknown, field: string): TextField {
  if (typeof value === 'string' && (TEXT_FIELDS as readonly string[]).includes(value)) {
    return value as TextField;
  }
  throw new Error(`Invalid parameter "${field}": expected one of ${TEXT_FIELDS.join(', ')}.`);
}

export interface UpdateTextParams {
  id: string;
  field: TextField;
  text: string;
}

/**
 * Narrows the params for `updateText` into the exact shape
 * `BdMutations.updateText` builds an argv from.
 *
 * `id` reuses `requireTargetId`'s non-blank check. `text` must be a string;
 * it is rejected only when blank AND `field === 'title'` — an empty title
 * is nonsensical and bd will not accept one, but the other four fields
 * accept `''` as bd's documented way to clear them, so this deliberately
 * does not go through `requireString`-style blank rejection for those.
 */
export function narrowUpdateTextParams(params: Record<string, unknown>): UpdateTextParams {
  const id = requireTargetId(params.id, 'id');
  const field = requireTextField(params.field, 'field');
  if (typeof params.text !== 'string') {
    throw new Error('Missing required parameter "text".');
  }
  if (field === 'title' && params.text.trim() === '') {
    throw new Error('Invalid parameter "text": title must not be empty.');
  }
  return { id, field, text: params.text };
}

/**
 * Narrows the params for `createBead` into the exact shape
 * `BdMutations.create` builds an argv from.
 *
 * `type`, `priority`, `parent` and `status` are deliberately NOT checked
 * against a list of known values: beads vocabulary is user-extensible, so
 * only the shape is enforced here and the `bd` CLI stays the authority on
 * which values exist (it rejects an unknown one with a readable error).
 * Unknown fields are ignored; blank optional strings are treated as absent
 * so no empty flag ever reaches an argv.
 */
export function narrowCreateParams(params: Record<string, unknown>): CreateBeadParams {
  if (typeof params.title !== 'string' || params.title.trim() === '') {
    throw new Error('Missing required parameter "title".');
  }
  const narrowed: CreateBeadParams = { title: params.title.trim() };

  const type = optionalString(params.type, 'type');
  if (type !== undefined) narrowed.type = type;
  const priority = optionalString(params.priority, 'priority');
  if (priority !== undefined) narrowed.priority = priority;
  const parent = optionalString(params.parent, 'parent');
  if (parent !== undefined) narrowed.parent = parent;
  const description = optionalString(params.description, 'description');
  if (description !== undefined) narrowed.description = description;
  const design = optionalString(params.design, 'design');
  if (design !== undefined) narrowed.design = design;
  const acceptance = optionalString(params.acceptance, 'acceptance');
  if (acceptance !== undefined) narrowed.acceptance = acceptance;
  const status = optionalString(params.status, 'status');
  if (status !== undefined) narrowed.status = status;

  if (params.labels !== undefined) {
    if (!Array.isArray(params.labels) || params.labels.some((label) => typeof label !== 'string')) {
      throw new Error('Invalid parameter "labels": expected an array of strings.');
    }
    const labels = (params.labels as string[]).map((label) => label.trim()).filter((label) => label !== '');
    if (labels.length > 0) narrowed.labels = labels;
  }

  if (params.due !== undefined) {
    // Reuses the setDue narrowing; '' means "clear" there, which for a
    // brand-new issue is the same as not setting a due date at all.
    const due = requireDueDate(params.due, 'due');
    if (due !== '') narrowed.due = due;
  }

  if (params.estimate !== undefined) {
    if (typeof params.estimate !== 'number' || !Number.isFinite(params.estimate) || params.estimate <= 0) {
      throw new Error('Invalid parameter "estimate": expected a positive finite number of minutes.');
    }
    narrowed.estimate = params.estimate;
  }

  return narrowed;
}

/**
 * `undefined` means "not provided"; anything else must be a string. A blank
 * string narrows to `undefined` too, so the argv builder never emits a flag
 * with an empty value.
 */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid parameter "${field}": expected a string.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
