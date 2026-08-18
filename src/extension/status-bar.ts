/**
 * Status bar affordance: how many issues are ready to work on, right now,
 * without opening anything.
 *
 * `statusBarContent` is a pure function, testable without an editor host —
 * the same split as `poll-gate.ts`. This file imports `vscode` only as a
 * type (`import type`), never as a runtime value: `vscode` does not resolve
 * outside the extension host, so a real import would make this module
 * unimportable from the unit test suite. `createBeadsStatusBar` instead
 * takes the `vscode` namespace as a parameter, supplied by `extension.ts`
 * where a real import is available.
 */
import type * as vscode from 'vscode';

import type { StoreState } from './store';

export interface StatusBarContent {
  text: string;
  tooltip: string;
}

/**
 * Decide what the status bar item should show for a given store state.
 *
 * `gatesInSnapshot` is accepted as a separate, optional argument rather than
 * read off `state.snapshot` directly: `DashboardSnapshot` does not carry a
 * `gates` field yet (that lands with a sibling feature), so this function is
 * not coupled to that field existing. Once it does, the caller can read
 * `snapshot.gates` defensively and pass it through here unchanged.
 *
 * Priority, highest first:
 *   1. `state.error` — a live failure must never be hidden behind a stale
 *      count, so it wins even if a previous snapshot is still cached.
 *   2. `state.snapshot` — shown as-is. A refresh in flight does not clear
 *      the previous snapshot (see `BeadsStore.refresh`), so this also covers
 *      "loading, but keep the last good count on screen".
 *   3. Neither present (first load, nothing fetched yet) — `undefined`,
 *      meaning the item should be hidden rather than show a fake zero.
 */
export function statusBarContent(
  state: StoreState,
  gatesInSnapshot?: unknown[],
): StatusBarContent | undefined {
  if (state.error) {
    return {
      text: '$(warning) Beads',
      tooltip: `Beads: ${state.error.message}`,
    };
  }

  if (!state.snapshot) return undefined;

  const ready = state.snapshot.readyIds.length;
  const gateCount = gatesInSnapshot?.length ?? 0;

  const text =
    gateCount > 0
      ? `$(dashboard) ${ready} ready · $(shield) ${gateCount}`
      : `$(dashboard) ${ready} ready`;

  const tooltipLines = [`${ready} issue(s) ready to work on`];
  if (gateCount > 0) tooltipLines.push(`${gateCount} gate(s) open`);
  tooltipLines.push('Click to open the Beads dashboard.');

  return { text, tooltip: tooltipLines.join('\n') };
}

/**
 * Wire the pure content above to a real status bar item.
 *
 * Applies the current state immediately (does not wait for the first
 * `onDidChange` firing) so the item is correct from the moment it appears,
 * and shows/hides itself as content becomes available or disappears.
 *
 * @param vscodeApi the caller's own `import * as vscode from 'vscode'` —
 * injected rather than imported here so this module stays importable from
 * the unit test suite (see the file header).
 */
export function createBeadsStatusBar(
  store: {
    readonly current: StoreState;
    onDidChange: (listener: (state: StoreState) => void) => vscode.Disposable;
  },
  vscodeApi: typeof vscode,
): vscode.Disposable {
  const item = vscodeApi.window.createStatusBarItem(
    'beadsDashboard.status',
    vscodeApi.StatusBarAlignment.Left,
    100,
  );
  item.command = 'beadsDashboard.openDashboard';

  const apply = (state: StoreState): void => {
    const content = statusBarContent(state);
    if (!content) {
      item.hide();
      return;
    }
    item.text = content.text;
    item.tooltip = content.tooltip;
    item.show();
  };

  apply(store.current);
  const subscription = store.onDidChange(apply);

  return {
    dispose: () => {
      subscription.dispose();
      item.dispose();
    },
  };
}
