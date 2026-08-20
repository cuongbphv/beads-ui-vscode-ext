// @vitest-environment jsdom

/**
 * `GitChanges`: the diffstat badge, purely a function of the
 * `WorktreeGitStatus` it is handed.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { WorktreeGitStatus } from '../shared/fleet';
import { GitChanges } from '../webview/components/fleet/git-changes';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let mounted: Root | undefined;
let container: HTMLElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.unmount());
    mounted = undefined;
  }
  container?.remove();
  container = undefined;
});

async function render(git: WorktreeGitStatus | undefined): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(GitChanges, { git })));
  return container;
}

function status(overrides: Partial<WorktreeGitStatus> = {}): WorktreeGitStatus {
  return {
    branch: 'main',
    changedFiles: 0,
    insertions: 0,
    deletions: 0,
    measuredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('GitChanges', () => {
  it('renders nothing when there is no git status yet', async () => {
    const el = await render(undefined);
    expect(el.textContent).toBe('');
  });

  it('renders "clean" for a worktree with no changes', async () => {
    const el = await render(status());
    expect(el.textContent).toContain('clean');
  });

  it('renders the file count and +/- diffstat for a changed worktree', async () => {
    const el = await render(status({ changedFiles: 2, insertions: 5, deletions: 3 }));
    expect(el.textContent).toContain('2 files');
    expect(el.textContent).toContain('+5');
    expect(el.textContent).toContain('-3');
  });

  it('uses the singular "1 file" rather than "1 files"', async () => {
    const el = await render(status({ changedFiles: 1, insertions: 1, deletions: 0 }));
    expect(el.textContent).toContain('1 file');
    expect(el.textContent).not.toContain('1 files');
  });

  it('renders a git error instead of the diffstat when git.error is set', async () => {
    const el = await render(status({ error: 'not a git repository' }));
    expect(el.textContent).toContain('git error');
    expect(el.textContent).not.toContain('clean');
  });
});
