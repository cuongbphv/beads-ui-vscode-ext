/**
 * Sidebar tree: a "Needs You" bucket, then Epic → Task.
 *
 * The tree is a navigator, not a second dashboard — one line per issue, the
 * detail lives in the webview and the tooltip.
 */
import * as vscode from 'vscode';

import { StatusIndex, groupByEpic, progressOf } from '../../shared/model';
import { PRIORITY_LABELS, type Bead, type DashboardSnapshot } from '../../shared/types';
import type { BeadsStore } from '../store';

type NodeKind = 'section' | 'epic' | 'bead' | 'message';

/**
 * Children rendered per epic (and in "Needs You") before a "…and N more" node.
 * A 2000-issue project would otherwise build 2000 TreeItems on every refresh,
 * and a 300-child epic is unreadable long before it is slow (T402).
 */
const CHILD_CAP = 100;

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

  constructor(private readonly store: BeadsStore) {
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
    const showClosed = vscode.workspace.getConfiguration('beadsUi').get<boolean>('showClosed', true);

    const visible = showClosed
      ? snapshot.beads
      : snapshot.beads.filter((bead) => !index.isDone(bead.status));

    const roots: BeadNode[] = [];

    // "Needs You" is the whole point of the sidebar: what can be started now.
    const readySet = new Set(snapshot.readyIds);
    const ready = visible.filter((bead) => readySet.has(bead.id));
    if (ready.length > 0) {
      roots.push(
        section(`Needs You (${ready.length})`, this.capped(ready, index), 'flame'),
      );
    }

    for (const group of groupByEpic(visible, index)) {
      const node = new BeadNode(
        'epic',
        group.epic.id === '__unassigned__' ? undefined : group.epic,
        group.epic.title,
        group.children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        this.capped(group.children, index),
      );

      node.description = `${group.doneCount}/${group.totalCount} · ${progressOf(group)}%`;
      node.iconPath = iconForType(group.epic.issue_type);
      node.contextValue = group.epic.id === '__unassigned__' ? 'group' : 'beadEpic';
      if (group.epic.id !== '__unassigned__') {
        node.id = `epic:${group.epic.id}`;
        node.tooltip = tooltipFor(group.epic, index);
        node.command = openCommand(group.epic);
      }
      roots.push(node);
    }

    if (roots.length === 0) {
      roots.push(messageNode('No issues yet. Run `bd create` to add one.', 'info'));
    }
    return roots;
  }

  /**
   * Leaf nodes for at most `CHILD_CAP` issues, with a final node naming what
   * was left out. The overflow node opens the dashboard, which pages properly.
   */
  private capped(beads: Bead[], index: StatusIndex): BeadNode[] {
    const nodes = beads.slice(0, CHILD_CAP).map((bead) => this.leaf(bead, index));
    const hidden = beads.length - nodes.length;
    if (hidden > 0) {
      const more = messageNode(`…and ${hidden} more — open the dashboard`, 'ellipsis');
      more.command = { command: 'beadsUi.openDashboard', title: 'Open Dashboard' };
      nodes.push(more);
    }
    return nodes;
  }

  private leaf(bead: Bead, index: StatusIndex): BeadNode {
    const node = new BeadNode('bead', bead, bead.title, vscode.TreeItemCollapsibleState.None);
    const statusDef = index.def(bead.status);

    node.id = `bead:${bead.id}`;
    node.description = `${statusDef?.icon ?? ''} P${bead.priority}${bead.assignee ? ` · ${bead.assignee}` : ''}`;
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

function section(label: string, children: BeadNode[], icon: string): BeadNode {
  const node = new BeadNode(
    'section',
    undefined,
    label,
    vscode.TreeItemCollapsibleState.Expanded,
    children,
  );
  node.iconPath = new vscode.ThemeIcon(icon);
  node.contextValue = 'section';
  return node;
}

function messageNode(text: string, icon: string): BeadNode {
  const node = new BeadNode('message', undefined, text, vscode.TreeItemCollapsibleState.None);
  node.iconPath = new vscode.ThemeIcon(icon);
  node.contextValue = 'message';
  return node;
}

function openCommand(bead: Bead): vscode.Command {
  return { command: 'beadsUi.openBead', title: 'Open Issue', arguments: [bead.id] };
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
