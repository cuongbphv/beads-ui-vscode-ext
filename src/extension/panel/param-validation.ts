/**
 * Pure RPC-param narrowing helpers used by the router.
 *
 * Split out of `router.ts` so they can be unit-tested directly: `router.ts`
 * imports `vscode`, which vitest cannot resolve outside the extension host,
 * so nothing exported from that file is importable from a unit test. This
 * file imports nothing at runtime — no `vscode`, no `react` — and never
 * will; the one `import type` below is erased at compile time.
 */
import type { CreateBeadParams, DepType, TextField } from '../../shared/protocol';

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
 * `dep add --type`'s allowlist — CLI shape, not beads' user-extensible
 * vocabulary, same rationale as `TEXT_FIELDS` above. bd's own default when
 * `--type` is omitted is `'blocks'`, which `requireDepType` mirrors.
 */
const DEP_TYPES: readonly DepType[] = [
  'blocks',
  'tracks',
  'related',
  'parent-child',
  'discovered-from',
  'until',
  'caused-by',
  'validates',
  'relates-to',
  'supersedes',
];

/**
 * Narrows the optional `type` param for `addDependency`. `undefined` narrows
 * to bd's own default, `'blocks'`; anything else must be in `DEP_TYPES` or
 * this throws before an argv is ever built.
 */
export function requireDepType(value: unknown, field: string): DepType {
  if (value === undefined) return 'blocks';
  if (typeof value === 'string' && (DEP_TYPES as readonly string[]).includes(value)) {
    return value as DepType;
  }
  throw new Error(`Invalid parameter "${field}": expected one of ${DEP_TYPES.join(', ')}.`);
}

export interface DependencyParams {
  id: string;
  dependsOn: string;
}

export interface AddDependencyParams extends DependencyParams {
  type: DepType;
}

/**
 * Narrows the `id`/`dependsOn` pair shared by `addDependency` and
 * `removeDependency`, and rejects a self-edge (`id === dependsOn`) before any
 * argv is built — `bd dep add`/`bd dep remove` would otherwise happily wire
 * (or unwire) an issue against itself.
 */
export function narrowDependencyParams(params: Record<string, unknown>): DependencyParams {
  const id = requireString(params.id, 'id');
  const dependsOn = requireString(params.dependsOn, 'dependsOn');
  if (id === dependsOn) {
    throw new Error('Invalid parameter "dependsOn": an issue cannot depend on itself.');
  }
  return { id, dependsOn };
}

/**
 * Narrows the params for `addDependency` into the exact shape
 * `BdMutations.addDependency` builds an argv from: the shared self-edge check
 * above, plus `type` narrowed against `DEP_TYPES`.
 */
export function narrowAddDependencyParams(params: Record<string, unknown>): AddDependencyParams {
  const { id, dependsOn } = narrowDependencyParams(params);
  const type = requireDepType(params.type, 'type');
  return { id, dependsOn, type };
}

/**
 * Same non-blank check `router.ts`'s local `requireString` performs, kept
 * here too so this file needs no import from `router.ts` (which pulls in
 * `vscode` and is not importable from a unit test — see the file doc comment
 * above).
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required parameter "${field}".`);
  }
  return value;
}

export interface LabelParams {
  id: string;
  label: string;
}

/**
 * Narrows the `id`/`label` pair shared by `addLabel` and `removeLabel`, into
 * the exact shape `BdMutations.addLabel`/`removeLabel` build an argv from.
 *
 * Unlike `TEXT_FIELDS` or `DEP_TYPES`, `label` has no allowlist to check
 * against — beads labels are user-defined and unbounded, same reasoning as
 * `type`/`priority`/`status` elsewhere in this file — so only its shape (a
 * non-blank string) is enforced here.
 */
export function narrowLabelParams(params: Record<string, unknown>): LabelParams {
  const id = requireString(params.id, 'id');
  if (typeof params.label !== 'string' || params.label.trim() === '') {
    throw new Error('Missing required parameter "label".');
  }
  return { id, label: params.label.trim() };
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

export interface DeferParams {
  id: string;
  until?: string;
  reason?: string;
}

/**
 * Narrows the params for `deferBead` into the exact shape
 * `BdMutations.defer` builds an argv from.
 *
 * `until` is deliberately NOT run through `requireDueDate`: measured against
 * `bd defer --help` on the installed CLI, `--until` accepts a free-form
 * relative expression (`tomorrow`, `+1h`, `next monday`), not a `YYYY-MM-DD`
 * date, so only its shape (absent, or a non-blank string) is checked here —
 * the CLI stays the authority on whether the expression parses.
 */
export function narrowDeferParams(params: Record<string, unknown>): DeferParams {
  const id = requireString(params.id, 'id');
  const until = optionalString(params.until, 'until');
  const reason = optionalString(params.reason, 'reason');
  const narrowed: DeferParams = { id };
  if (until !== undefined) narrowed.until = until;
  if (reason !== undefined) narrowed.reason = reason;
  return narrowed;
}

export interface ReopenParams {
  id: string;
  reason?: string;
}

/**
 * Narrows the params for `reopenBead` into the exact shape
 * `BdMutations.reopen` builds an argv from. `reason` has no allowlist to
 * check against — same reasoning as `close`'s `reason` elsewhere — so only
 * its shape (absent, or a non-blank string) is enforced.
 */
export function narrowReopenParams(params: Record<string, unknown>): ReopenParams {
  const id = requireString(params.id, 'id');
  const reason = optionalString(params.reason, 'reason');
  const narrowed: ReopenParams = { id };
  if (reason !== undefined) narrowed.reason = reason;
  return narrowed;
}

/**
 * `undefined` means "not provided"; anything else must be a string. A blank
 * string narrows to `undefined` too, so the argv builder never emits a flag
 * with an empty value. Exported so `narrowDeferParams`/`narrowReopenParams`
 * below can reuse it for `until`/`reason` — neither of those is beads
 * vocabulary or a fixed CLI shape, just an optional free-form string.
 */
export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`Invalid parameter "${field}": expected a string.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
