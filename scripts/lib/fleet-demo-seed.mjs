/**
 * Seed a fake-but-real Fleet scenario for the screenshot pipeline: one
 * orchestrator session, one worker with a rich transcript (headings, a list,
 * a fenced code block, a PASS token — everything the markdown renderer in
 * `src/webview/components/markdown.tsx` draws), and a real `wt-*` git
 * worktree with an uncommitted change so the worktree panel has something to
 * show besides "clean".
 *
 * The Fleet tab reads two real, unmocked sources — see
 * `src/extension/fleet/FleetService.ts` — and both are genuine filesystem
 * state here, not a fixture the extension is told to trust:
 *   1. `~/.claude/projects/<encoded-cwd>/` — Claude Code's own transcript
 *      store. The directory name this writes to is *the same workspace's*
 *      demo folder, encoded the same way `session-locator.ts` does, so this
 *      only ever creates a new, uniquely-named entry — it can never collide
 *      with a real project's session data.
 *   2. `git worktree list` on the demo workspace itself — a real worktree,
 *      created with real `git worktree add`, with a real uncommitted edit.
 *
 * Idempotent: re-running (as `--force` reseeding does) removes the previous
 * worktree/branch and project directory first.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SESSION_ID = 'demo-orchestrator';
const AGENT_ID = 'demo-worker-201';
const WORKTREE_BRANCH = 'work/harbor-201-sse-backoff';
const BEAD_ID = 'harbor-201';

/** Mirrors `src/extension/fleet/lib/session-locator.ts`'s `encodeProjectDirName` exactly. */
function encodeProjectDirName(absolutePath) {
  const withForwardSlashes = absolutePath.replace(/\\/g, '/');
  return withForwardSlashes.replace(/[/:]/g, '-');
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function line(obj) {
  return `${JSON.stringify(obj)}\n`;
}

/**
 * @param {string} outDir the seeded demo workspace (e.g. .../harbor)
 * @returns {string} the worktree path created, for logging
 */
export function seedFleetDemo(outDir) {
  const worktreePath = join(dirname(outDir), 'wt-201');

  // ── 1. A real worktree, with a real uncommitted change ───────────────────
  // Local-only identity: this throwaway repo must commit even on a machine
  // with no global git user configured (a fresh CI runner, a fresh clone).
  run('git', ['config', 'user.email', 'demo@example.invalid'], outDir);
  run('git', ['config', 'user.name', 'Beads Dashboard Demo'], outDir);
  run('git', ['add', '-A'], outDir);
  try {
    run('git', ['commit', '-q', '-m', 'seed'], outDir);
  } catch {
    // Nothing to commit (already committed by a previous seed run) — fine.
  }

  try {
    run('git', ['worktree', 'remove', '--force', worktreePath], outDir);
  } catch {
    // No previous worktree, or its directory was already removed by hand —
    // `worktree prune` below cleans up git's own bookkeeping either way.
  }
  rmSync(worktreePath, { recursive: true, force: true });
  try {
    run('git', ['worktree', 'prune'], outDir);
  } catch {
    // Best-effort — a failure here does not block re-creating the worktree.
  }
  try {
    run('git', ['branch', '-D', WORKTREE_BRANCH], outDir);
  } catch {
    // No previous branch — fine.
  }

  run('git', ['worktree', 'add', '-b', WORKTREE_BRANCH, worktreePath], outDir);
  // An uncommitted edit, so the worktree panel shows real changed-file
  // counts instead of a clean tree.
  writeFileSync(
    join(worktreePath, 'sse-controller.md'),
    ['# SSE backoff notes', '', 'Reconnect delay doubles up to a 30s cap. See harbor-201.', ''].join('\n'),
  );

  // ── 2. A real Claude Code project directory with an orchestrator + worker ─
  const projectDirName = encodeProjectDirName(outDir);
  const projectDir = join(homedir(), '.claude', 'projects', projectDirName);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(join(projectDir, SESSION_ID, 'subagents'), { recursive: true });

  // The orchestrator session file only needs to exist — FleetService reads
  // its mtime, not its content (see `discoverSessions`).
  writeFileSync(join(projectDir, `${SESSION_ID}.jsonl`), line({ type: 'queue-operation' }));

  const now = new Date();
  const at = (secondsAgo) => new Date(now.getTime() - secondsAgo * 1000).toISOString();

  const transcript = [
    // Spawn brief: FleetService's readFirstUserMessage/parseSpawnBrief reads
    // exactly this first line for the bead id and worktree path.
    line({
      type: 'user',
      uuid: 'brief',
      timestamp: at(90),
      message: {
        role: 'user',
        content: `Nhận bead ${BEAD_ID}, làm việc trong worktree \`${worktreePath}\`. Stream build logs qua SSE, thêm backoff khi mất kết nối.`,
      },
    }),
    line({
      type: 'assistant',
      uuid: 'a1',
      timestamp: at(75),
      message: {
        role: 'assistant',
        content: [
          {
            type: 'thinking',
            thinking:
              '## Plan\n\n- Read the current SSE controller\n- Add exponential backoff, capped at 30s\n- Cover the disconnect path with a test',
          },
        ],
      },
    }),
    line({
      type: 'assistant',
      uuid: 'a2',
      timestamp: at(60),
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { path: 'src/server/sse-controller.ts' } }],
      },
    }),
    line({
      type: 'user',
      uuid: 'a3',
      timestamp: at(55),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'export function nextDelay(previous) {\n  return Math.min(previous * 2, 30_000);\n}\n' },
        ],
      },
    }),
    line({
      type: 'assistant',
      uuid: 'a4',
      timestamp: at(20),
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text:
              '## Summary\n\nAdded exponential backoff to the SSE reconnect loop and covered it with a new test.\n\n- `src/server/sse-controller.ts` — retry delay now doubles up to a 30s cap\n- `src/server/sse-controller.test.ts` — asserts the delay sequence\n\n```ts\ntest(\'backoff doubles up to a 30s cap\', () => {\n  expect(nextDelay(16_000)).toBe(30_000)\n})\n```\n\n**Result:** ✓ PASSED — 42/42 tests green.',
          },
        ],
      },
    }),
    line({
      type: 'user',
      uuid: 'a5',
      timestamp: at(5),
      message: { role: 'user', content: 'Trông tốt, merge nhé.' },
    }),
  ].join('');

  const agentFilePath = join(projectDir, SESSION_ID, 'subagents', `agent-${AGENT_ID}.jsonl`);
  writeFileSync(agentFilePath, transcript);
  // `workerStatus` reads this file's mtime against ACTIVE_WINDOW_MS (2 min) —
  // touch it to "now" so the demo worker shows as running, not idle.
  utimesSync(agentFilePath, now, now);

  return worktreePath;
}
