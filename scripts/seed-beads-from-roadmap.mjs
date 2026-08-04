#!/usr/bin/env node
/**
 * Seed the local beads database from the Velox roadmaps.
 *
 * Reads .velox/docs/roadmaps/M*-ROADMAP.md and produces one `bd create --graph`
 * plan: an epic per milestone, a task per roadmap row, parent-child edges from
 * milestone to task, and sibling `blocks` edges following each slice's declared
 * priority order (so `bd ready` / `bd blocked` return something meaningful).
 *
 * The roadmap is the source of truth; this script is idempotent only in the
 * sense that it refuses to run against a non-empty database unless --force is
 * passed. It never deletes anything.
 *
 * Usage:
 *   node scripts/seed-beads-from-roadmap.mjs --dry-run   # print the plan, create nothing
 *   node scripts/seed-beads-from-roadmap.mjs             # create the graph
 *   node scripts/seed-beads-from-roadmap.mjs --force     # allow a non-empty database
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const roadmapDir = join(repoRoot, '.velox', 'docs', 'roadmaps');

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');
const force = argv.has('--force');

/** Roadmap `[x]`/`[ ]`/`[~]` → beads status name. */
const STATUS_BY_CHECKBOX = {
  '[x]': 'closed',
  '[~]': 'in_progress',
  '[ ]': 'open',
};

/** Milestone → priority. M001 is the active milestone, later ones matter less now. */
const PRIORITY_BY_MILESTONE = { M001: 1, M002: 2, M003: 2, M004: 3 };

function bd(args, opts = {}) {
  return execFileSync('bd', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, BD_JSON_ENVELOPE: '0' },
    ...opts,
  });
}

/**
 * Parse one roadmap file into { id, name, goal, slices: [{ id, name, tasks }] }.
 *
 * Mirrors Velox's own parser contract (engine/roadmap_sync.py): a table counts
 * only when its header row has both a `Task` and a `Status` cell, and column
 * positions are read from that header rather than assumed.
 */
function parseRoadmap(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);

  const milestone = { id: null, name: null, goal: '', slices: [] };
  const titleMatch = text.match(/^#\s*Milestone\s+(M\d{3})\s+—\s+(.+)$/m);
  if (!titleMatch) throw new Error(`${path}: no "# Milestone M### — Name" heading`);
  milestone.id = titleMatch[1];
  milestone.name = titleMatch[2].trim();

  const goalMatch = text.match(/^\*\*Goal:\*\*\s*([\s\S]*?)(?=\n\n)/m);
  if (goalMatch) milestone.goal = goalMatch[1].replace(/\s*\n\s*/g, ' ').trim();

  let slice = null;
  let taskCol = null;
  let statusCol = null;
  let featureCol = null;
  let refCol = null;
  let headerWidth = 0;

  for (const line of lines) {
    const sliceMatch = line.match(/^##\s+Slice\s+(\S+):\s*(.+?)\s*\((Backend|Frontend)\)\s*$/);
    if (sliceMatch) {
      slice = { id: sliceMatch[1].replace(/:$/, ''), name: sliceMatch[2].trim(), tasks: [] };
      milestone.slices.push(slice);
      taskCol = statusCol = null;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !slice) continue;

    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const lower = cells.map((c) => c.toLowerCase());

    if (lower.includes('task') && lower.includes('status')) {
      taskCol = lower.indexOf('task');
      statusCol = lower.indexOf('status');
      featureCol = lower.findIndex((c) => c.includes('feature') || c.includes('component'));
      refCol = lower.indexOf('source reference');
      headerWidth = cells.length;
      continue;
    }
    if (taskCol === null) continue;
    if (/^[-:\s]+$/.test(cells.join(''))) continue; // separator row
    if (cells.length !== headerWidth) continue;

    const id = cells[taskCol];
    if (!/^T\d{3}$/.test(id)) continue;

    const checkbox = cells[statusCol];
    if (!(checkbox in STATUS_BY_CHECKBOX)) {
      throw new Error(`${path}: task ${id} has invalid status cell ${JSON.stringify(checkbox)}`);
    }

    slice.tasks.push({
      id,
      feature: featureCol >= 0 ? cells[featureCol] : '',
      reference: refCol >= 0 ? cells[refCol] : '',
      status: STATUS_BY_CHECKBOX[checkbox],
    });
  }

  return milestone;
}

/** First sentence-ish of the feature cell, for a scannable bead title. */
function shortTitle(taskId, feature) {
  const head = feature.split(':')[0].trim();
  const title = head.length > 0 && head.length <= 70 ? head : feature.slice(0, 70).trim();
  return `${taskId} — ${title}`;
}

/**
 * Build the `bd create --graph` plan plus the follow-up work.
 *
 * `bd` 1.1.2 silently drops `status` and `deps` from graph nodes (it warns
 * "unknown field(s)"), even though newer sources declare them. So the plan
 * carries only what this bd honours, and status + blocks edges are applied in
 * separate passes against the real ids the graph create returns.
 */
function buildPlan(milestones) {
  const nodes = [];
  const blocks = [];

  for (const m of milestones) {
    const taskCount = m.slices.reduce((n, s) => n + s.tasks.length, 0);
    const doneCount = m.slices.reduce(
      (n, s) => n + s.tasks.filter((t) => t.status === 'closed').length,
      0,
    );

    // An epic is only "closed" when every child is; partially-done milestones
    // are in_progress so the board has something in the wip column.
    let epicStatus = 'open';
    if (taskCount > 0 && doneCount === taskCount) epicStatus = 'closed';
    else if (doneCount > 0) epicStatus = 'in_progress';

    nodes.push({
      key: m.id,
      title: `${m.id} — ${m.name}`,
      type: 'epic',
      priority: PRIORITY_BY_MILESTONE[m.id] ?? 2,
      description: m.goal,
      labels: ['roadmap', m.id.toLowerCase()],
      _status: epicStatus,
    });

    for (const slice of m.slices) {
      let previousKey = null;

      for (const task of slice.tasks) {
        const node = {
          key: task.id,
          title: shortTitle(task.id, task.feature),
          type: 'task',
          _status: task.status,
          priority: PRIORITY_BY_MILESTONE[m.id] ?? 2,
          parent_key: m.id,
          labels: ['roadmap', m.id.toLowerCase(), slice.id.toLowerCase()],
          description: [
            task.feature,
            '',
            `Milestone: ${m.id} — ${m.name}`,
            `Slice: ${slice.id} (${slice.name})`,
            task.reference ? `Source reference: ${task.reference}` : '',
            '',
            `Roadmap: .velox/docs/roadmaps/${m.id}-ROADMAP.md`,
          ]
            .filter(Boolean)
            .join('\n'),
        };

        // Chain each slice in its declared priority order so the dependency
        // graph is real: only the head of an unfinished chain shows up ready.
        // Applied in a second pass — see the note on `status` below.
        if (previousKey && task.status !== 'closed') {
          blocks.push({ blockerKey: previousKey, blockedKey: task.id });
        }
        previousKey = task.id;

        nodes.push(node);
      }
    }
  }

  return { nodes, blocks };
}

function main() {
  const files = readdirSync(roadmapDir)
    .filter((f) => /^M\d{3}-ROADMAP\.md$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`no roadmaps found in ${roadmapDir}`);

  const milestones = files.map((f) => parseRoadmap(join(roadmapDir, f)));
  const { nodes, blocks } = buildPlan(milestones);

  const epics = nodes.filter((n) => n.type === 'epic').length;
  const byStatus = nodes.reduce((acc, n) => {
    acc[n._status] = (acc[n._status] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Parsed ${files.length} roadmaps -> ${epics} epics, ${nodes.length - epics} tasks`);
  console.log(`Target status distribution: ${JSON.stringify(byStatus)}`);
  console.log(`Blocks edges to wire: ${blocks.length}`);

  const keys = nodes.map((n) => n.key);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) throw new Error(`duplicate plan keys: ${dupes.join(', ')}`);

  // `_status` is ours, not part of the bd schema — strip it before writing.
  const plan = { nodes: nodes.map(({ _status, ...node }) => node) };

  const outDir = join(repoRoot, '.beads');
  mkdirSync(outDir, { recursive: true });
  const planPath = join(outDir, 'roadmap-seed-plan.json');
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`Wrote plan: ${planPath}`);

  if (dryRun) {
    const preview = JSON.parse(bd(['create', '--graph', planPath, '--dry-run', '--json']));
    console.log(`Dry run OK: ${preview.node_count} nodes validated.`);
    return;
  }

  const existing = JSON.parse(bd(['count', '--json'])).count ?? 0;
  if (existing > 0 && !force) {
    console.error(
      `Refusing to seed: database already has ${existing} issues. ` +
        `Re-run with --force if you really want to add the roadmap on top.`,
    );
    process.exit(1);
  }

  // Pass 1 — create every bead with its parent-child edge.
  const ids = JSON.parse(bd(['create', '--graph', planPath, '--json'])).ids ?? {};
  const created = Object.keys(ids).length;
  if (created !== nodes.length) {
    throw new Error(`expected ${nodes.length} beads, bd created ${created}`);
  }
  console.log(`Pass 1: created ${created} beads.`);

  // Pass 2 — wire the sibling blocks chains in bulk.
  if (blocks.length > 0) {
    const edges = blocks
      .map((b) => JSON.stringify({ from: ids[b.blockedKey], to: ids[b.blockerKey], type: 'blocks' }))
      .join('\n');
    const edgePath = join(outDir, 'roadmap-seed-deps.jsonl');
    writeFileSync(edgePath, `${edges}\n`);
    bd(['dep', 'add', '--file', edgePath]);
    console.log(`Pass 2: wired ${blocks.length} blocks edges.`);
  }

  // Pass 3 — set the non-default statuses, one `bd update` per distinct status.
  const idsByStatus = new Map();
  for (const node of nodes) {
    if (node._status === 'open') continue; // bd's create default
    if (!idsByStatus.has(node._status)) idsByStatus.set(node._status, []);
    idsByStatus.get(node._status).push(ids[node.key]);
  }
  for (const [status, statusIds] of idsByStatus) {
    bd(['update', ...statusIds, '--status', status]);
    console.log(`Pass 3: set ${statusIds.length} beads to ${status}.`);
  }

  console.log('\nSeeded. Milestone epics:');
  for (const m of milestones) {
    console.log(`  ${m.id} -> ${ids[m.id] ?? '(missing)'}`);
  }
}

main();
