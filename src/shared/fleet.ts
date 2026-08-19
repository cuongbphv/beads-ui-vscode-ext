/**
 * Fleet tab: types shared between the extension host and the webview,
 * describing the state of a `bead-fleet` run — orchestrators, workers, the
 * worktrees they live in and the git status of each — plus the transcript
 * events streamed for a given agent or session.
 *
 * Framework-free by contract (see CLAUDE.md): no `vscode`, no `react` here.
 * This file is types only; the parsers that build these values live under
 * `src/extension/fleet/lib/`.
 */

/** What a transcript subscription follows: one agent, or a whole session. */
export type TranscriptTarget = `agent:${string}` | `session:${string}`;

export interface WorktreeGitStatus {
  /** Current branch name, or `null` when detached or unreadable. */
  branch: string | null;
  /** Files with uncommitted changes (working tree + index), from `git status`. */
  changedFiles: number;
  /** Lines added against HEAD, from `git diff HEAD --numstat`. */
  insertions: number;
  /** Lines removed against HEAD, from `git diff HEAD --numstat`. */
  deletions: number;
  /** Set instead of throwing when git could not be read (timeout, not a repo, ...). */
  error?: string;
  /** ISO timestamp of when this status was last measured. */
  measuredAt: string;
}

export interface FleetWorktree {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Directory's own name, e.g. `wt-19r1`. */
  dirName: string;
  git: WorktreeGitStatus;
  /** bead id this worktree was matched to, via a worker's brief or a name match. */
  beadId: string | null;
}

export interface FleetWorker {
  agentId: string;
  sessionId: string;
  /** bead id parsed from the spawn brief; `null` when the brief did not name one. */
  beadId: string | null;
  /** Worktree path parsed from the spawn brief; `null` when not detected. */
  worktreePath: string | null;
  /** First line of the spawn brief, for display in the worker list. */
  briefSummary: string;
  /** ISO timestamp of the most recent transcript event seen for this agent. */
  lastActivityAt: string | null;
  status: 'running' | 'idle' | 'unknown';
}

export interface FleetOrchestrator {
  sessionId: string;
  /** Agent ids of the workers this session has spawned. */
  workerIds: string[];
  /** ISO timestamp of the most recent transcript event seen for this session. */
  lastActivityAt: string | null;
}

export interface FleetSnapshot {
  orchestrators: FleetOrchestrator[];
  workers: FleetWorker[];
  worktrees: FleetWorktree[];
  /** Worktree paths on disk that no worker or bead id currently claims. */
  orphanWorktrees: string[];
  /** Set when discovery degraded — e.g. `~/.claude/projects` is missing. */
  degraded?: { reason: string };
  /** ISO timestamp of when this snapshot was assembled. */
  generatedAt: string;
}

export interface TranscriptTextBlock {
  type: 'text';
  text: string;
  /** True when `text` was cut short to stay under the block's size cap. */
  truncated: boolean;
}

export interface TranscriptThinkingBlock {
  type: 'thinking';
  thinking: string;
  truncated: boolean;
}

export interface TranscriptToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  /** The tool's input, serialized to JSON and capped. */
  input: string;
  truncated: boolean;
}

export interface TranscriptToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  /** Flattened to text whether the source was a plain string or content blocks. */
  content: string;
  isError: boolean;
  truncated: boolean;
}

export type TranscriptBlock =
  | TranscriptTextBlock
  | TranscriptThinkingBlock
  | TranscriptToolUseBlock
  | TranscriptToolResultBlock;

export interface TranscriptEvent {
  uuid: string | null;
  /** Every other transcript line type (attachments, summaries, ...) collapses to `'other'`. */
  role: 'user' | 'assistant' | 'other';
  timestamp: string | null;
  agentId: string | null;
  sessionId: string | null;
  blocks: TranscriptBlock[];
}

export interface TranscriptBackfill {
  target: TranscriptTarget;
  events: TranscriptEvent[];
  /** Byte offset in the source file immediately after the backfilled region. */
  offset: number;
  /** True when the backfill window was smaller than the whole transcript file. */
  truncated: boolean;
  totalBytes: number;
}
