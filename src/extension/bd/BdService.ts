/**
 * The single place in the extension that spawns the `bd` CLI.
 *
 * Everything else — queries, mutations, the tree, the webview — goes through
 * here. See .velox/docs/DECISIONS.md DEC-001 for why the CLI is the only
 * supported interface (never `.beads/issues.jsonl`, never the Dolt files).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { RpcError, RpcErrorKind } from '../../shared/protocol';

const execFileAsync = promisify(execFile);

/** 16 MB: a 2000-issue `bd list --json` is well under this, with headroom. */
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Backoff (ms) between bounded retries of a spawn that failed with
 * ENOENT/EINVAL even after the shell fallback (see `spawn` below). Two
 * retries (three attempts total); short enough to add negligible latency to
 * a genuinely-missing-binary failure, long enough to ride out a
 * process-creation hiccup on the same machine.
 */
const SPAWN_RETRY_DELAYS_MS = [50, 150];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BdServiceOptions {
  /** Absolute path to the workspace folder containing `.beads`. */
  cwd: string;
  /** Override for the `bd` executable (`beadsDashboard.bdPath`). Defaults to `bd`. */
  bdPath?: string;
  /** Called with every argv and its duration, for the output channel. */
  log?: (message: string) => void;
}

/** A `bd` invocation that failed, carrying the normalised RpcError. */
export class BdError extends Error {
  readonly rpcError: RpcError;

  constructor(rpcError: RpcError, readonly output?: unknown) {
    super(rpcError.message);
    this.name = 'BdError';
    this.rpcError = rpcError;
  }
}

interface ExecFailure {
  code?: number | string;
  stdout?: string;
  stderr?: string;
  message?: string;
}

/**
 * bd's `--json` payloads come in two shapes:
 *   legacy (current default) — the payload itself, e.g. a bare array
 *   envelope                 — `{"schema_version":1,"data": <payload>}`
 *
 * We pin `BD_JSON_ENVELOPE=0` but still unwrap defensively, because the
 * envelope becomes the default in bd 2.0 and a user's shell may export it.
 */
function unwrapEnvelope(value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'data' in value &&
    'schema_version' in value
  ) {
    return (value as { data: unknown }).data;
  }
  return value;
}

/**
 * Pull a readable message out of whatever bd printed on failure.
 *
 * bd is not consistent here (verified on 1.1.2): `bd ready --json` emits a JSON
 * object with an `error` key, while `bd list --json` emits a plain
 * `Error: ...` line. Both have to produce the same RpcError.
 */
function parseErrorOutput(stderr: string, stdout: string): { message: string; code?: string; output?: unknown } {
  // A note on stderr must not hide a typed refusal printed on stdout.
  for (const stream of [stderr, stdout]) {
    try {
      const parsed = unwrapEnvelope(JSON.parse(stream.trim())) as { error?: string; code?: string };
      if (parsed && typeof parsed.error === 'string') {
        return { message: parsed.error, code: parsed.code, output: parsed };
      }
    } catch {
      // Try the other stream before falling back to prose.
    }
  }
  for (const stream of [stderr, stdout]) {
    const firstLine = stream.trim().split(/\r?\n/)[0].replace(/^Error:\s*/i, '').trim();
    if (firstLine) return { message: firstLine };
  }
  return { message: 'bd failed without producing an error message' };
}

/**
 * True when a *shell* reported that the command itself does not exist.
 *
 * A shell launches fine even when its argument does not, so the ENOENT that
 * `execFile` would have raised never reaches us — cmd.exe exits 1 with "is not
 * recognized", sh exits 127. Without this the missing-binary case degrades into
 * a generic bd-error and the user never sees the setup guidance.
 */
function isMissingCommand(failure: ExecFailure): boolean {
  if (failure.code === 127 || failure.code === 9009) return true;
  const text = `${failure.stderr ?? ''}${failure.message ?? ''}`.toLowerCase();
  return (
    text.includes('is not recognized as an internal or external command') ||
    text.includes('is not recognized as the name of a cmdlet') ||
    text.includes('command not found')
  );
}

/**
 * True when `execFile` failed to launch `bdPath` at all, rather than `bd`
 * itself running and exiting non-zero.
 *
 * Node's own error code for "cannot launch this without a shell" is not
 * stable across versions: measured on Node 22.15.0 on a real Windows machine,
 * pointing `bdPath` straight at an npm `.cmd` shim raises `EINVAL`, not the
 * `ENOENT` older assumptions (and other setups) raise for the same shim. Both
 * mean the same thing — retry through the shell / report bd-not-found — so
 * both are treated the same here rather than trusting one hardcoded code
 * never re-measured against a real Windows process.
 */
function needsShellRetry(failure: ExecFailure): boolean {
  return failure.code === 'ENOENT' || failure.code === 'EINVAL';
}

/**
 * Which failure shape this is.
 *
 * The phrases are bd's, not ours: 1.1.2 says "no beads database found" with a
 * hint naming `bd init`, older builds said "no .beads directory". Matching on
 * the text is unlovely, but bd exits 1 for every refusal, so the exit code
 * cannot tell "you have no workspace" from "that status does not exist".
 */
function classify(message: string): RpcErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes('no beads database') || lower.includes('no embedded database')) {
    return 'no-workspace';
  }
  if (lower.includes('not a beads') || lower.includes('no .beads')) return 'no-workspace';
  if (lower.includes('bd init')) return 'no-workspace';
  return 'bd-error';
}

/**
 * The executable to spawn, given whatever `beadsDashboard.bdPath` currently holds.
 *
 * Unset and blank are the same answer — plain `bd`, resolved off the editor's
 * `PATH` — but they have to stay distinguishable from a real path, so the
 * normalisation lives in one place used by both the constructor and
 * `setBdPath`.
 */
function normalizeBdPath(bdPath: string | undefined): string {
  return bdPath?.trim() || 'bd';
}

export class BdService {
  private readonly cwd: string;
  private bdPath: string;
  private readonly log: (message: string) => void;

  /**
   * Identical concurrent reads are coalesced: the tree and the webview both ask
   * for the issue list on activation, and one Dolt open is enough.
   */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /** Set once a plain execFile has failed to launch and a shell retry worked. */
  private useShell = false;

  constructor(options: BdServiceOptions) {
    this.cwd = options.cwd;
    this.bdPath = normalizeBdPath(options.bdPath);
    this.log = options.log ?? (() => {});
  }

  /** The executable currently being spawned. `bd` when the setting is unset. */
  get executable(): string {
    return this.bdPath;
  }

  /**
   * Point at a different `bd` without rebuilding the service.
   *
   * `beadsDashboard.bdPath` is a live setting: the missing-binary toast sends
   * the user straight to it, so the fix has to apply to this same instance —
   * `BdQueries`, `BdMutations` and the store's mutation subscription all hold a
   * reference to it, and swapping the object out would silently drop them.
   *
   * Two pieces of state are about the *old* executable and must not survive it:
   * `useShell`, which is a fact learned about one binary, and any coalesced
   * read still in flight, which would otherwise hand a caller asking after the
   * change an answer produced by the path they just replaced.
   */
  setBdPath(bdPath: string | undefined): void {
    const next = normalizeBdPath(bdPath);
    if (next === this.bdPath) return;

    this.bdPath = next;
    this.useShell = false;
    this.inFlight.clear();
    this.log(`bd path changed to ${next}`);
  }

  /** Run `bd <args> --json` and return the parsed, envelope-unwrapped payload. */
  async json<T>(args: string[]): Promise<T> {
    const stdout = await this.run([...args, '--json']);
    if (stdout.trim() === '') return null as T;
    try {
      return unwrapEnvelope(JSON.parse(stdout)) as T;
    } catch {
      throw new BdError({
        kind: 'bad-output',
        message: `Could not parse JSON from \`bd ${args.join(' ')}\`.`,
        detail: stdout.slice(0, 2000),
      });
    }
  }

  /** JSON Lines commands have one independent JSON record per nonblank line. */
  async jsonLines<T>(args: string[]): Promise<T[]> {
    const stdout = await this.run([...args, '--json']);
    try {
      return stdout.split(/\r?\n/).filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as T);
    } catch {
      throw new BdError({
        kind: 'bad-output',
        message: `Could not parse JSON Lines from \`bd ${args.join(' ')}\`.`,
        detail: stdout.slice(0, 2000),
      });
    }
  }

  /** Same as `json`, but coalesces identical concurrent calls. */
  async jsonShared<T>(args: string[]): Promise<T> {
    // NUL separator, written as an escape on purpose: a raw 0x00 byte in this
    // source makes git treat the file as binary and silences grep/rg. It beats
    // a space because argv elements may themselves contain spaces.
    const key = args.join('\u0000');
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = this.json<T>(args).finally(() => {
      // Only retract our own entry: `setBdPath` clears the map mid-flight, and
      // a settling call from the old path must not evict a newer one.
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  /** Run a mutating command. Returns stdout; callers usually ignore it. */
  async exec(args: string[]): Promise<string> {
    return this.run(args);
  }

  private async run(args: string[]): Promise<string> {
    const started = Date.now();
    try {
      const { stdout } = await this.spawn(args);
      this.log(`bd ${args.join(' ')} — ${Date.now() - started}ms`);
      return stdout;
    } catch (error) {
      const failure = error as ExecFailure;

      if (needsShellRetry(failure)) {
        throw new BdError({
          kind: 'bd-not-found',
          message:
            `Could not run "${this.bdPath}". Install the beads CLI, or set ` +
            '`beadsDashboard.bdPath` to its full path.',
          detail: failure.message,
        });
      }

      const { message, code, output } = parseErrorOutput(failure.stderr ?? '', failure.stdout ?? '');
      this.log(`bd ${args.join(' ')} — FAILED (${failure.code}): ${message}`);
      throw new BdError({
        kind: classify(message),
        message,
        code,
        exitCode: typeof failure.code === 'number' ? failure.code : undefined,
        detail: failure.stderr?.slice(0, 4000),
      }, output);
    }
  }

  /**
   * On Windows, an npm-installed `bd` is a `.cmd` shim that `execFile` cannot
   * launch directly. Retry once through the shell, then remember the answer so
   * later calls skip the failed attempt.
   *
   * A single "try plain, fall back to shell" pass is not enough under heavy
   * concurrent load. Measured on a real Windows dev machine (beads-ui-vscode-ext-e78):
   * `bd` on PATH resolves to an npm `.cmd` shim (`bd.cmd`) ahead of the real
   * `bd.exe`, so `spawnOnce` below takes the shell-fallback branch on *every*
   * cold call, not just occasionally — the plain attempt is guaranteed to
   * ENOENT/EINVAL (Windows cannot launch a `.cmd` without a shell), and the
   * shell retry itself spawns `cmd.exe` -> `node.exe` -> the shim's JS entry
   * point. That is three new OS processes for one `bd` invocation. Running
   * the full vitest suite (370+ files, 1250+ tests, many worker processes
   * each spawning `bd` concurrently) intermittently produced
   * `BdError: Could not run "bd"` from individual bd-live.test.ts cases —
   * never from that file run alone — i.e. only once the suite's *aggregate*
   * concurrent process-creation load was added on top of the tripled
   * per-call cost above.
   *
   * [Unverified as a live-caught reproduction: the failure did not recur in
   * the several full-suite runs performed while diagnosing and fixing this
   * (it is intermittent by the bead's own report — most reruns come back
   * clean). The mechanism above — every call already paying a 3-process
   * cost, then piling that up across hundreds of concurrent workers — is
   * corroborated by reading the spawn code and the actual PATH resolution on
   * this machine, not by catching the failure mid-flight.] A bounded retry
   * cannot make a genuinely-missing `bd` look installed: that case fails
   * identically (ENOENT/EINVAL on the plain attempt, then the shell attempt
   * also fails to find it) on every attempt, so retrying only adds up to
   * `SPAWN_RETRY_DELAYS_MS`'s total of latency before the same
   * `bd-not-found` BdError is thrown from `run()`.
   */
  private async spawn(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const options = {
      cwd: this.cwd,
      encoding: 'utf8' as const,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, BD_JSON_ENVELOPE: '0' },
    };

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.spawnOnce(args, options);
      } catch (error) {
        if (attempt >= SPAWN_RETRY_DELAYS_MS.length || !needsShellRetry(error as ExecFailure)) {
          throw error;
        }
        await delay(SPAWN_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  /** One plain-then-shell-fallback attempt. See `spawn` for the retry wrapping this. */
  private async spawnOnce(
    args: string[],
    options: Record<string, unknown>,
  ): Promise<{ stdout: string; stderr: string }> {
    if (this.useShell) {
      return execFileAsync(this.bdPath, args, { ...options, shell: true });
    }

    try {
      return await execFileAsync(this.bdPath, args, options);
    } catch (error) {
      if (!needsShellRetry(error as ExecFailure)) throw error;
      try {
        const viaShell = await execFileAsync(this.bdPath, args, { ...options, shell: true });
        this.useShell = true;
        this.log(`bd resolved via shell (Windows .cmd shim): ${this.bdPath}`);
        return viaShell;
      } catch (shellError) {
        // The shell could not find it either, so the binary really is absent:
        // re-throw the original ENOENT/EINVAL rather than the shell's own wording.
        if (isMissingCommand(shellError as ExecFailure)) throw error;
        throw shellError;
      }
    }
  }
}
