/**
 * Seed one poured `bd mol` molecule for the Molecules tab screenshot (bead
 * beads-ui-vscode-ext-9e9.14).
 *
 * Before this, the Harbor demo workspace had zero molecules, so a plain
 * capture of the Molecules tab only ever showed its empty state — despite
 * the tab being named explicitly in earlier screenshot-refresh work, no
 * screenshot of it ever existed. This mirrors the fixture design already
 * proven in `scripts/e2e/molecules-gates.spec.mjs`'s "fixdemo" molecule: an
 * epic distilled into a formula, poured, then each poured step nudged into
 * one of the five visually distinct states `StepList`/`MoleculeCard` can
 * render — done / current / ready / pending / gated — so the card and its
 * step list both photograph as "a real molecule mid-flight", not a fixture
 * with every step in the same state.
 *
 * `bd mol pour` sets the poured root's *title* to the formula name, not the
 * source epic's title (verified live in the e2e spec above) — so the card
 * in the screenshot reads "ssepatch", and `capture-screens.mjs` locates it
 * by that same `FORMULA_NAME`, imported from here rather than re-typed.
 */

/** Poured root's title == this, and the formula bd stores it under. */
export const FORMULA_NAME = 'ssepatch';

const EPIC_TITLE = 'Ship the SSE backoff patch';

/**
 * Step titles, kept slug-friendly (letters, spaces only) so
 * `bd mol distill`'s slugification is exactly `toLowerCase` + hyphens —
 * the same assumption `molecules-gates.spec.mjs` already relies on for its
 * own "Step Done"/"Step Current"/etc. fixture titles.
 */
const STEP_TITLES = {
  done: 'Write SSE backoff tests',
  current: 'Wire backoff into client',
  ready: 'Update the changelog',
  pending: 'Publish the patch release',
  gated: 'Get security sign off',
};

function slugify(title) {
  return title.toLowerCase().replace(/\s+/g, '-');
}

/**
 * @param {(args: string[]) => string} bd `seed-demo-workspace.mjs`'s own
 *   `-C <outDir>`-pinned `bd` runner — every call here goes through it, so
 *   nothing in this module can touch a project other than the one already
 *   asserted-outside-the-repo by the caller.
 * @returns {{ rootId: string, gateId: string, pouredIds: Record<string, string> }}
 */
export function seedMoleculeDemo(bd) {
  function bdJson(args) {
    return JSON.parse(bd([...args, '--json']));
  }

  const epic = bdJson(['create', EPIC_TITLE, '--type', 'epic']);
  const stepIds = {};
  for (const [key, title] of Object.entries(STEP_TITLES)) {
    const step = bdJson(['create', title, '--type', 'task']);
    bd(['dep', 'add', step.id, epic.id, '--type', 'parent-child']);
    stepIds[key] = step.id;
  }

  // "Publish the patch release" blocks on "Update the changelog" so it comes
  // back genuinely `pending` (not `ready`) after pouring — status is derived
  // from the dependency graph the template carries through distill/pour, not
  // from anything set after the fact.
  bd(['dep', 'add', stepIds.pending, stepIds.ready, '--type', 'blocks']);

  bd(['mol', 'distill', epic.id, FORMULA_NAME]);
  // `mol distill` only *reads* the epic and its children to write the
  // formula file — it never touches the source issues. Left alone, this
  // epic and its 5 task children survive as ordinary, permanently visible
  // issues in the demo project (confirmed live: they showed up as a second
  // "Ship the SSE backoff patch" epic plus duplicate-titled tasks cluttering
  // Overview's blocked list, on top of the real poured molecule below).
  // Deleting the source after distilling has no effect on the formula file
  // `mol pour` reads next.
  bd(['delete', epic.id, '--cascade', '--force']);
  const pour = bdJson(['mol', 'pour', FORMULA_NAME]);
  const rootId = pour.new_epic_id;
  const idFor = (key) => pour.id_mapping?.[`${FORMULA_NAME}.${slugify(STEP_TITLES[key])}`];

  const pouredIds = {
    done: idFor('done'),
    current: idFor('current'),
    ready: idFor('ready'),
    pending: idFor('pending'),
    gated: idFor('gated'),
  };
  if (!rootId || Object.values(pouredIds).some((id) => !id)) {
    throw new Error(
      `molecule demo pour did not produce every expected step id: ${JSON.stringify(pour.id_mapping)}`,
    );
  }

  // Status is per-issue runtime state, not template structure — set it on
  // the poured copies directly, same as the e2e fixture.
  bd(['close', pouredIds.done]);
  bd(['update', pouredIds.current, '--claim']);

  // A gate is real runtime state too, never templated: it can only attach to
  // an already-poured step, which is why it happens last.
  const gate = bdJson([
    'gate',
    'create',
    '--type',
    'human',
    '--blocks',
    pouredIds.gated,
    '--reason',
    'Confirm the key-rotation window with security before this patch ships.',
  ]);

  return { rootId, gateId: gate.id, pouredIds };
}
