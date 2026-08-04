/**
 * Where the demo workspace lives.
 *
 * Shared by the seeder and by the harnesses that open it, so `--demo` means the
 * same folder everywhere without anyone typing a path. Outside the repository on
 * purpose: `bd` discovers `.beads` by walking up, and a demo tracker nested
 * inside this one is a foot-gun waiting for a missing `-C`.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEMO_PREFIX } from './demo-project.mjs';

/** The folder name is what the editor's title bar shows in the screenshots. */
export function defaultDemoDir() {
  return join(tmpdir(), 'beads-dashboard-demo', DEMO_PREFIX);
}

/** Issue-id prefix of the seeded project, e.g. `harbor-`. */
export const DEMO_ID_PREFIX = `${DEMO_PREFIX}-`;
