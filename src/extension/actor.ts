/**
 * Resolving the current user for the sidebar's "Needs You" section.
 *
 * The precedence lives in `shared/actor.ts`; this file only supplies the
 * evidence — the setting, the environment, git, and the OS. It is the one place
 * outside BdService that spawns a process, and deliberately so: `git config
 * user.name` is a read-only identity probe, not a beads operation, and putting
 * it inside BdService would blur what that class is a contract for.
 */
import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import { normalizeActor, resolveActor, type ActorSources } from '../shared/actor';

const execFileAsync = promisify(execFile);

/** git answers instantly or it is broken; never hold up a refresh for it. */
const GIT_TIMEOUT = 3_000;

export class ActorResolver implements vscode.Disposable {
  /** `undefined` = not probed yet; `null` = probed and nobody was found. */
  private cached: string | null | undefined;
  private pending: Promise<string | undefined> | undefined;
  private readonly subscription: vscode.Disposable;

  private readonly emitter = new vscode.EventEmitter<string | undefined>();
  /** Fires when the identity changes — the probe landing, or the setting. */
  readonly onDidChange = this.emitter.event;

  constructor(private readonly cwd: string) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('beadsUi.assignee')) return;
      // Re-probe: clearing the setting should fall back to git, not to nothing.
      this.cached = undefined;
      this.pending = undefined;
      void this.resolve();
    });
  }

  /** The last resolved identity, without waiting. Drives synchronous renders. */
  get current(): string | undefined {
    // The setting outranks everything, so a freshly typed one applies before
    // the git probe has had a chance to run.
    const override = normalizeActor(
      vscode.workspace.getConfiguration('beadsUi').get<string>('assignee'),
    );
    return override ?? this.cached ?? undefined;
  }

  /** Resolve once per session, then serve from cache. */
  async resolve(): Promise<string | undefined> {
    if (this.cached !== undefined) return this.current;
    if (this.pending) return this.pending;

    this.pending = (async () => {
      const sources: ActorSources = {
        setting: vscode.workspace.getConfiguration('beadsUi').get<string>('assignee'),
        beadsActorEnv: process.env.BEADS_ACTOR,
        bdActorEnv: process.env.BD_ACTOR,
        gitUserName: await this.gitUserName(),
        osUser: process.env.USERNAME ?? process.env.USER ?? safeOsUser(),
      };
      const actor = resolveActor(sources);
      this.cached = actor ?? null;
      this.pending = undefined;
      return actor;
    })();

    const actor = await this.pending;
    this.emitter.fire(actor);
    return actor;
  }

  /**
   * Whatever git would stamp on a commit here. Silent on every failure: no git,
   * no repo, or no configured name are all ordinary, and none of them are worth
   * an error to the user — the section simply explains how to set the name.
   */
  private async gitUserName(): Promise<string | undefined> {
    const options = { cwd: this.cwd, timeout: GIT_TIMEOUT, windowsHide: true } as const;
    try {
      const { stdout } = await execFileAsync('git', ['config', 'user.name'], options);
      return stdout.trim() || undefined;
    } catch {
      // Windows installs git as a shim that execFile cannot always launch
      // directly; the same retry BdService performs for bd.
      try {
        const { stdout } = await execFileAsync('git', ['config', 'user.name'], {
          ...options,
          shell: true,
        });
        return stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

/** `userInfo()` throws on a host with no passwd entry — a container, usually. */
function safeOsUser(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}
