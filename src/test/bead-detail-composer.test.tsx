// @vitest-environment jsdom

/**
 * The comment composer in the detail pane.
 *
 * Comments used to be a section that vanished at zero comments, which hid
 * the only place to add one. These tests cover the replacement: the section
 * (and its composer) always renders, a submit sends the trimmed draft
 * through `addComment`, Escape cancels the draft without closing the pane,
 * and the composer disables itself while a write is in flight — the same
 * `busy` gate every other quick action in this pane already shares.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead, BeadComment } from '../shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

interface PendingCall {
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * `showBead` resolves immediately with whatever `comments` currently holds —
 * every test wants that settled before it starts asserting. Every other
 * method (`addComment`, `appendNotes`, ...) is queued so a test can control
 * exactly when the write resolves, which is what the "disabled while busy"
 * case needs.
 */
const rpc = vi.hoisted(() => ({
  calls: [] as PendingCall[],
  comments: [] as BeadComment[],
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: Record<string, unknown>) => {
    if (method === 'showBead') {
      return Promise.resolve({ bead: null, comments: rpc.comments });
    }
    return new Promise((resolve, reject) => {
      rpc.calls.push({ method, params, resolve, reject });
    });
  },
  asRpcError: (error: unknown) =>
    error && typeof error === 'object' && 'kind' in error
      ? error
      : { kind: 'unknown', message: String(error) },
}));

vi.mock('../webview/components/toast', () => ({
  useToast: () => ({ notify: vi.fn() }),
}));

import { BeadDetail } from '../webview/components/bead-detail';

let mountedRoot: Root | undefined;
let container: HTMLDivElement | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount());
    mountedRoot = undefined;
  }
  container?.remove();
  container = undefined;
  rpc.calls.length = 0;
  rpc.comments = [];
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

const bead: Bead = {
  id: 'bd-1',
  title: 'Wire up the composer',
  status: 'open',
  priority: 2,
  issue_type: 'task',
};

async function mount(onClose = vi.fn()): Promise<{ root: HTMLDivElement; onClose: typeof onClose }> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadDetail, {
        bead,
        beads: [bead],
        index,
        onClose,
        onSelect: vi.fn(),
        refreshKey: 0,
      }),
    ),
  );
  // Let the `showBead` fetch inside useBeadDetail settle.
  await act(async () => {
    await Promise.resolve();
  });
  return { root: container, onClose };
}

function commentTextarea(root: HTMLDivElement): HTMLTextAreaElement {
  const el = root.querySelector('#comment-draft');
  if (!(el instanceof HTMLTextAreaElement)) throw new Error('comment composer not found');
  return el;
}

function commentButton(root: HTMLDivElement): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Comment');
  if (!button) throw new Error('Comment button not found');
  return button;
}

/**
 * React tracks a controlled `<textarea>`'s value through the *instance*
 * property it installs over the native prototype setter, so assigning
 * `el.value = x` directly leaves React's tracker thinking nothing changed —
 * the subsequent `input` event is then a no-op. Going through the prototype
 * setter first (the same trick React Testing Library's `fireEvent` uses) is
 * what makes the change visible to React's synthetic `onChange`.
 */
function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('comment composer', () => {
  it('renders the composer even when the issue has zero comments', async () => {
    rpc.comments = [];
    const { root } = await mount();

    expect(root.textContent).toContain('Comments (0)');
    expect(root.textContent).toContain('No comments yet.');
    expect(root.querySelector('#comment-draft')).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('submits the trimmed draft through addComment and clears it on success', async () => {
    const { root } = await mount();
    const textarea = commentTextarea(root);

    await act(async () => typeInto(textarea, '  looks good to me  '));

    await act(async () => commentButton(root).click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('addComment');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', text: 'looks good to me' });

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });

    expect(commentTextarea(root).value).toBe('');
  });

  it('keeps the draft when the write fails', async () => {
    const { root } = await mount();
    const textarea = commentTextarea(root);

    await act(async () => typeInto(textarea, 'will fail'));
    await act(async () => commentButton(root).click());

    await act(async () => {
      rpc.calls[0].reject({ kind: 'bd-error', message: 'bd refused' });
      await Promise.resolve();
    });

    expect(commentTextarea(root).value).toBe('will fail');
  });

  it('disables the submit button while empty, and both controls while busy', async () => {
    const { root } = await mount();
    const textarea = commentTextarea(root);

    expect(commentButton(root).disabled).toBe(true);

    await act(async () => typeInto(textarea, 'in flight'));
    expect(commentButton(root).disabled).toBe(false);

    await act(async () => commentButton(root).click());

    // The write has not resolved yet: both the textarea and the button share
    // the pane's one `busy` flag, same as Status/Priority/Assignee/Close.
    expect(commentTextarea(root).disabled).toBe(true);
    expect(commentButton(root).disabled).toBe(true);

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });
  });

  it('Escape clears the draft and does not close the pane', async () => {
    const onClose = vi.fn();
    const { root } = await mount(onClose);
    const textarea = commentTextarea(root);

    await act(async () => typeInto(textarea, 'abandon me'));
    expect(textarea.value).toBe('abandon me');

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(commentTextarea(root).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });
});
