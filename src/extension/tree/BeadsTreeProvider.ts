/**
 * Sidebar trees, one per view in the Beads container.
 *
 *   Needs You            issues where you are the PIC — your queue
 *   Epics & Milestones   the plan: Epic → Task, with progress,
 *                        and Unassigned as its triage queue
 *
 * They are lenses over the same list, not a partition: your task under an epic
 * appears in both, which is the point. Only the plan view is exhaustive, so
 * nothing can drop out of the tree.
 *
 * Each is a separate registered view rather than a root node in one tree, so
 * VSCode gives it its own title bar, collapse state and draggable height — the
 * way Explorer stacks Folders / Outline / Timeline.
 *
 * The tree is a navigator, not a second dashboard — one line per issue, the
 * detail lives in the webview and the tooltip.
 */
import * as vscode from 'vscode';

import { StatusIndex, buildSidebarSections, progressOf } from '../../shared/model';
import {
  PRIORITY_LABELS,
  type Bead,
  type DashboardSnapshot,
  type EpicGroup,
} from '../../shared/types';
import type { ActorResolver } from '../actor';
import type { BeadsStore } from '../store';

type NodeKind = 'section' | 'epic' | 'bead' | 'message';

/** Which of the container's views a provider instance feeds. */
export type SidebarScope = 'mine' | 'plan';

/**
 * Children rendered per epic (and in "Needs You") before a "…and N more" node.
 * A 2000-issue project would otherwise build 2000 TreeItems on every refresh,
 * and a 300-child epic is unreadable long before it is slow (T402).
 */
const CHILD_CAP = 100;

/** How a section wants its issue rows rendered. */
interface LeafOptions {
  /** Keeps TreeItem ids unique when one issue appears in two sections. */
  scope: 'mine' | 'plan' | 'triage';
  /** Ids from `bd ready`, annotated on the row where that is actionable. */
  ready?: ReadonlySet<string>;
  /** Suppress the assignee, which is a constant inside "Needs You". */
  hideAssignee?: boolean;
}

export class BeadNode extends vscode.TreeItem {
  constructor(
    readonly kind: NodeKind,
    readonly bead: Bead | undefined,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly children: BeadNode[] = [],
  ) {
    super(label, collapsibleState);
  }
}

/** Icon per issue type. Falls back to a generic glyph for custom types. */
function iconForType(type: string): vscode.ThemeIcon {
  switch (type) {
    case 'epic':
      return new vscode.ThemeIcon('milestone');
    case 'bug':
      return new vscode.ThemeIcon('bug');
    case 'feature':
      return new vscode.ThemeIcon('lightbulb');
    case 'chore':
      return new vscode.ThemeIcon('tools');
    case 'decision':
      return new vscode.ThemeIcon('law');
    case 'spike':
      return new vscode.ThemeIcon('beaker');
    case 'story':
      return new vscode.ThemeIcon('book');
    case 'milestone':
      return new vscode.ThemeIcon('flag');
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

/**
 * Priority is carried by the icon colour *and* the description text, never by
 * colour alone — the a11y rule from the design system.
 */
function colorForPriority(priority: number): vscode.ThemeColor | undefined {
  switch (priority) {
    case 0:
      return new vscode.ThemeColor('charts.red');
    case 1:
      return new vscode.ThemeColor('charts.orange');
    case 2:
      return new vscode.ThemeColor('charts.blue');
    default:
      return undefined;
  }
}

export class BeadsTreeProvider implements vscode.TreeDataProvider<BeadNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<BeadNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private roots: BeadNode[] = [];
  private readonly byId = new Map<string, BeadNode>();
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly store: BeadsStore,
    private readonly actor: ActorResolver,
    /**
     * Which sidebar view this instance feeds. The container registers one view
     * per scope so each gets its own title bar, collapse state and height —
     * root nodes inside a single view cannot do any of that.
     */
    private readonly scope: SidebarScope = 'plan',
  ) {
    this.subscription = store.onDidChange(() => this.rebuild());
    this.rebuild();
  }

  getTreeItem(element: BeadNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BeadNode): BeadNode[] {
    return element ? element.children : this.roots;
  }

  /** Lets `reveal()` walk up from a bead node. */
  getParent(element: BeadNode): BeadNode | undefined {
    return this.parents.get(element);
  }

  private readonly parents = new WeakMap<BeadNode, BeadNode>();

  nodeFor(id: string): BeadNode | undefined {
    return this.byId.get(id);
  }

  private rebuild(): void {
    const { snapshot, error, loading } = this.store.current;

    if (error && !snapshot) {
      this.roots = [messageNode(error.message, 'error')];
    } else if (!snapshot) {
      this.roots = [messageNode(loading ? 'Loading issues…' : 'No data yet.', 'loading')];
    } else {
      this.roots = this.build(snapshot);
    }

    this.byId.clear();
    const indexNode = (node: BeadNode): void => {
      if (node.bead) this.byId.set(node.bead.id, node);
      for (const child of node.children) {
        this.parents.set(child, node);
        indexNode(child);
      }
    };
    for (const root of this.roots) indexNode(root);

    this.emitter.fire(undefined);
  }

  private build(snapshot: DashboardSnapshot): BeadNode[] {
    const index = new StatusIndex(snapshot.vocabulary.statuses);
    const showClosed = vscode.workspace.getConfiguration('beadsDashboard').get<boolean>('showClosed', true);
    const me = this.actor.current;

    if (snapshot.beads.length === 0) {
      return [messageNode('No issues yet. Run `bd create` to add one.', 'info')];
    }

    const { mine, plan, unassigned } = buildSidebarSections(snapshot.beads, index, {
      me,
      showClosed,
      readyIds: snapshot.readyIds,
    });

    const readySet = new Set(snapshot.readyIds);

    // Each scope fills its own view, so the roots here are the section's
    // contents — the view title carries the heading the wrapper node used to.
    if (this.scope === 'mine') {
      if (!me) return [whoAreYouNode()];
      return mine.length > 0
        ? this.capped(mine, index, { scope: 'mine', ready: readySet, hideAssignee: true })
        : // Names the identity it resolved: an empty queue and a wrong name look
          // identical otherwise.
          [messageNode(`Nothing is assigned to ${me}.`, 'check')];
    }

    // Unassigned rides along in the plan view rather than claiming a third one:
    // it is a triage queue, usually short, and a section that is empty most days
    // costs more height than it earns.
    return [
      ...plan.map((group) => this.planNode(group, index)),
      section(
        `Unassigned (${unassigned.length})`,
        unassigned.length > 0
          ? this.capped(unassigned, index, { scope: 'triage', ready: readySet })
          : [messageNode('Everything open has an owner.', 'check')],
        'inbox',
        'no PIC yet',
      ),
    ];
  }

  /** One epic (or milestone, or non-epic parent) with its rollup. */
  private planNode(group: EpicGroup, index: StatusIndex): BeadNode {
    const synthetic = group.epic.id === '__unassigned__';
    const node = new BeadNode(
      'epic',
      synthetic ? undefined : group.epic,
      group.epic.title,
      group.children.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      this.capped(group.children, index, { scope: 'plan' }),
    );

    node.description = `${group.doneCount}/${group.totalCount} · ${progressOf(group)}%`;
    node.iconPath = iconForType(group.epic.issue_type);
    node.contextValue = synthetic ? 'group' : 'beadEpic';
    if (!synthetic) {
      node.id = `epic:${group.epic.id}`;
      node.tooltip = tooltipFor(group.epic, index);
      node.command = openCommand(group.epic);
    }
    return node;
  }

  /**
   * Leaf nodes for at most `CHILD_CAP` issues, with a final node naming what
   * was left out. The overflow node opens the dashboard, which pages properly.
   */
  private capped(beads: Bead[], index: StatusIndex, options: LeafOptions): BeadNode[] {
    const nodes = beads.slice(0, CHILD_CAP).map((bead) => this.leaf(bead, index, options));
    const hidden = beads.length - nodes.length;
    if (hidden > 0) {
      const more = messageNode(`…and ${hidden} more — open the dashboard`, 'ellipsis');
      more.command = { command: 'beadsDashboard.openDashboard', title: 'Open Dashboard' };
      nodes.push(more);
    }
    return nodes;
  }

  private leaf(bead: Bead, index: StatusIndex, options: LeafOptions): BeadNode {
    const node = new BeadNode('bead', bead, bead.title, vscode.TreeItemCollapsibleState.None);
    const statusDef = index.def(bead.status);

    // The same issue legitimately appears in two sections; VS Code rejects a
    // tree that reuses an id, so the section is part of it.
    node.id = `bead:${options.scope}:${bead.id}`;

    // Ready is only worth calling out where it changes what you would do next:
    // in your own queue and in triage. Under an epic it is just noise.
    const parts = [[statusDef?.icon, `P${bead.priority}`].filter(Boolean).join(' ')];
    if (options.ready?.has(bead.id)) parts.push('ready');
    // In "Needs You" every row says the same name; spend the width on the rest.
    if (bead.assignee && !options.hideAssignee) parts.push(bead.assignee);
    node.description = parts.join(' · ');
    node.iconPath = new vscode.ThemeIcon(
      iconForType(bead.issue_type).id,
      colorForPriority(bead.priority),
    );
    node.tooltip = tooltipFor(bead, index);
    node.command = openCommand(bead);
    // Drives which context-menu items appear; closed issues lose "Close".
    node.contextValue = index.isDone(bead.status) ? 'beadClosed' : 'beadOpen';
    return node;
  }

  refresh(): void {
    this.rebuild();
  }

  dispose(): void {
    this.subscription.dispose();
    this.emitter.dispose();
  }
}

function section(
  label: string,
  children: BeadNode[],
  icon: string,
  description?: string,
): BeadNode {
  const node = new BeadNode(
    'section',
    undefined,
    label,
    vscode.TreeItemCollapsibleState.Expanded,
    children,
  );
  node.id = `section:${icon}`;
  node.iconPath = new vscode.ThemeIcon(icon);
  node.contextValue = 'section';
  node.description = description;
  return node;
}

/**
 * Shown instead of a "Needs You" list when nothing identifies the user.
 *
 * Silence would be indistinguishable from "you have no work", so the section
 * says what is missing and opens the setting that fixes it.
 */
function whoAreYouNode(): BeadNode {
  const node = messageNode('Set who you are to see your work', 'question');
  node.tooltip = new vscode.MarkdownString(
    'beads reads the assignee from `BEADS_ACTOR`, then `git config user.name`.\n\n' +
      'Set `beadsDashboard.assignee` to override it.',
  );
  node.command = {
    command: 'workbench.action.openSettings',
    title: 'Open Settings',
    arguments: ['beadsDashboard.assignee'],
  };
  return node;
}

function messageNode(text: string, icon: string): BeadNode {
  const node = new BeadNode('message', undefined, text, vscode.TreeItemCollapsibleState.None);
  node.iconPath = new vscode.ThemeIcon(icon);
  node.contextValue = 'message';
  return node;
}

function openCommand(bead: Bead): vscode.Command {
  return { command: 'beadsDashboard.openBead', title: 'Open Issue', arguments: [bead.id] };
}

function tooltipFor(bead: Bead, index: StatusIndex): vscode.MarkdownString {
  const statusDef = index.def(bead.status);
  const lines = [
    `**${bead.id}** · \`${bead.issue_type}\``,
    '',
    bead.title,
    '',
    `Status: ${statusDef?.icon ?? ''} ${bead.status}`,
    `Priority: ${PRIORITY_LABELS[bead.priority] ?? `P${bead.priority}`}`,
  ];
  if (bead.assignee) lines.push(`Assignee: ${bead.assignee}`);
  if (bead.labels?.length) lines.push(`Labels: ${bead.labels.join(', ')}`);
  if (bead.blocked_by_count) lines.push(`Blocked by ${bead.blocked_by_count} issue(s)`);

  const markdown = new vscode.MarkdownString(lines.join('\n'));
  markdown.supportThemeIcons = true;
  return markdown;
}
