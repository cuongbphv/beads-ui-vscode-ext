/**
 * Opt-in toast notifications: a human gate opens, or an issue assigned to you
 * becomes blocked.
 *
 * `decideNotifications` is the decision half, kept free of `vscode` so it is
 * testable without an editor — the same split as `status-bar.ts` /
 * `poll-gate.ts`. `createBeadsNotifier` is the thin wiring half: it imports
 * `vscode` only as a type (`import type`) and takes the real namespace as a
 * parameter, supplied by `extension.ts`, so this module stays importable from
 * the unit test suite.
 *
 * No-spam contract (all enforced in `decideNotifications`, not in the wiring):
 *   - The first snapshot this session has ever seen is the baseline. There is
 *     nothing to diff it against, so it never toasts — reopening the editor
 *     onto three already-open gates must stay silent.
 *   - A gate id notifies at most once per session (`alreadyNotified`), even if
 *     it closes and reopens later.
 *   - Multiple gates opening in the same tick coalesce into one message
 *     ("3 gates need you"), never one toast per id.
 *   - `mode: 'off'` never toasts, regardless of anything else below.
 */
import type * as vscode from 'vscode';

import { isSameActor } from '../shared/actor';
import { humanGates } from '../shared/model';
import type { DashboardSnapshot } from '../shared/types';
import { Debouncer } from './poll-gate';
import type { StoreState } from './store';

/**
 * `beadsDashboard.notifications`. `'gates'` covers gate-opened toasts only;
 * `'gates-and-blocked'` adds the "assigned to me became blocked" toast.
 */
export type NotificationsMode = 'off' | 'gates' | 'gates-and-blocked';

export interface NotificationDecision {
  kind: 'gate-opened' | 'own-blocked';
  /** Every issue id backing this decision — coalesced, never one per id. */
  ids: string[];
  message: string;
}

/**
 * Decide what (if anything) should toast between two snapshots.
 *
 * @param prev            the last snapshot this session evaluated, or
 *                         `undefined` for the very first one ever seen — that
 *                         case always returns `[]` (baseline, see file header).
 * @param next             the snapshot just fetched.
 * @param me                the resolved identity (`ActorResolver.current`),
 *                         or `undefined` when nobody could be identified —
 *                         own-blocked never fires without one.
 * @param mode             `beadsDashboard.notifications`.
 * @param alreadyNotified   gate ids already toasted this session (mutated by
 *                          the caller, not here — this function only reads it).
 */
export function decideNotifications(
  prev: DashboardSnapshot | undefined,
  next: DashboardSnapshot,
  me: string | undefined,
  mode: NotificationsMode,
  alreadyNotified: ReadonlySet<string>,
): NotificationDecision[] {
  if (mode === 'off') return [];
  // Baseline: nothing to diff against yet, so nothing here counts as "new".
  if (!prev) return [];

  const decisions: NotificationDecision[] = [];

  // --- Gate opened -----------------------------------------------------
  // Only `human` gates: timer/CI gates clear themselves, so they are never
  // worth interrupting anyone for (mirrors `humanGates` in `shared/model.ts`,
  // the same filter the sidebar's "Needs You" section uses).
  const prevHumanGateIds = new Set(humanGates(prev.gates).map((gate) => gate.id));
  const newGateIds = humanGates(next.gates)
    .map((gate) => gate.id)
    .filter((id) => !prevHumanGateIds.has(id) && !alreadyNotified.has(id));

  if (newGateIds.length > 0) {
    decisions.push({
      kind: 'gate-opened',
      ids: newGateIds,
      message: newGateIds.length === 1 ? '1 gate needs you.' : `${newGateIds.length} gates need you.`,
    });
  }

  // --- Own-blocked -------------------------------------------------------
  // Opt-in on top of gates: `mode === 'gates'` stops here.
  if (mode === 'gates-and-blocked' && me) {
    const prevBlockedIds = new Set(prev.blockedIds);
    const beadsById = new Map(next.beads.map((bead) => [bead.id, bead]));

    const newlyBlockedIds = next.blockedIds.filter((id) => {
      if (prevBlockedIds.has(id)) return false; // already blocked — not news
      const bead = beadsById.get(id);
      if (!bead) return false;
      return isSameActor(bead.assignee, me) || isSameActor(bead.owner, me);
    });

    if (newlyBlockedIds.length > 0) {
      const firstTitle = beadsById.get(newlyBlockedIds[0])?.title;
      decisions.push({
        kind: 'own-blocked',
        ids: newlyBlockedIds,
        message:
          newlyBlockedIds.length === 1
            ? `${firstTitle ?? newlyBlockedIds[0]} is now blocked.`
            : `${newlyBlockedIds.length} of your issues are now blocked.`,
      });
    }
  }

  return decisions;
}

export interface NotifierDeps {
  /** `ActorResolver.current` — read fresh on every snapshot, not cached here. */
  getIdentity: () => string | undefined;
  /**
   * Opens the dashboard, optionally focused on one issue — the exact closure
   * `extension.ts` builds for the `beadsDashboard.openBead` command, so "Show
   * issue" jumps the same way a sidebar click does.
   */
  openDashboard: (id?: string) => void;
}

/**
 * Wire the pure decision above to real `vscode.window` toasts.
 *
 * Reads `beadsDashboard.notifications` straight from `vscodeApi.workspace`
 * on every snapshot rather than caching it, so flipping the setting takes
 * effect on the very next change without a reload.
 *
 * @param vscodeApi the caller's own `import * as vscode from 'vscode'` —
 * injected rather than imported here so this module stays importable from
 * the unit test suite (see the file header).
 */
export function createBeadsNotifier(
  store: {
    readonly current: StoreState;
    onDidChange: (listener: (state: StoreState) => void) => vscode.Disposable;
  },
  vscodeApi: typeof vscode,
  deps: NotifierDeps,
): vscode.Disposable {
  // Reused rather than reimplemented, per the bead: leading-edge coalescing so
  // a burst of writes behind one refresh produces one evaluation, not N.
  const debouncer = new Debouncer();
  const alreadyNotified = new Set<string>();
  // Whatever the store already holds (usually nothing yet) is the baseline —
  // never toasted, so wiring this before the first `refresh()` lands is safe.
  let prevSnapshot: DashboardSnapshot | undefined = store.current.snapshot;

  const mode = (): NotificationsMode =>
    vscodeApi.workspace.getConfiguration('beadsDashboard').get<NotificationsMode>('notifications', 'off');

  const apply = (state: StoreState): void => {
    const snapshot = state.snapshot;
    if (!snapshot || snapshot === prevSnapshot) return;

    const currentMode = mode();
    if (currentMode === 'off') {
      // Off never toasts, but the baseline still advances: turning it back on
      // later must not unleash a backlog of everything that changed while it
      // was off.
      prevSnapshot = snapshot;
      return;
    }

    // Coalesced into the same burst as a signal already accepted: leave
    // `prevSnapshot` where it is so the *next* accepted tick's diff still
    // covers whatever changed in this one.
    if (!debouncer.signal()) return;

    const decisions = decideNotifications(prevSnapshot, snapshot, deps.getIdentity(), currentMode, alreadyNotified);
    prevSnapshot = snapshot;

    for (const decision of decisions) {
      for (const id of decision.ids) alreadyNotified.add(id);
      void showToast(decision, vscodeApi, deps.openDashboard);
    }
  };

  const subscription = store.onDidChange(apply);
  return {
    dispose: () => subscription.dispose(),
  };
}

/** Gate toasts are informational; a blocker on your own work is a warning. */
async function showToast(
  decision: NotificationDecision,
  vscodeApi: typeof vscode,
  openDashboard: (id?: string) => void,
): Promise<void> {
  const show =
    decision.kind === 'gate-opened'
      ? vscodeApi.window.showInformationMessage
      : vscodeApi.window.showWarningMessage;

  const choice = await show(decision.message, 'Open Dashboard', 'Show issue');
  if (choice === 'Open Dashboard') openDashboard();
  else if (choice === 'Show issue') openDashboard(decision.ids[0]);
}
