// @vitest-environment jsdom

/**
 * `EditableText` (description/design/acceptance) and the title inline editor
 * in the detail pane (bead li0.6), plus a stale-closure regression on the
 * assignee field's Escape handler (bead li0.12).
 *
 * `LongText` used to return `null` for an empty field, hiding the only way
 * to give it a first value. These tests cover the replacement: an empty
 * section renders a discoverable ghost "Add …" button, edit -> preview ->
 * save sends the trimmed draft through `updateText`, Escape cancels without
 * closing the pane, and the title pencil swaps to an input that commits on
 * Enter the same way the assignee field already does.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { StatusIndex } from '../shared/model';
import type { Bead } from '../shared/types';

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
 * `showBead` resolves immediately with `null` — every test here works off
 * the list-row summary passed to `mount`. Every other method is queued so a
 * test can control exactly when the write resolves.
 */
const rpc = vi.hoisted(() => ({
  calls: [] as PendingCall[],
}));

vi.mock('../webview/bridge/rpc', () => ({
  call: (method: string, params: Record<string, unknown>) => {
    if (method === 'showBead') {
      return Promise.resolve({ bead: null, comments: [] });
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
});

const index = new StatusIndex([
  { name: 'open', category: 'active' },
  { name: 'done', category: 'done' },
]);

function bead(overrides: Partial<Bead> = {}): Bead {
  return {
    id: 'bd-1',
    title: 'Wire up EditableText',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  };
}

async function mount(subject: Bead): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.append(container);
  mountedRoot = createRoot(container);
  await act(async () =>
    mountedRoot?.render(
      createElement(BeadDetail, {
        bead: subject,
        beads: [subject],
        index,
        onClose: vi.fn(),
        onSelect: vi.fn(),
        refreshKey: 0,
      }),
    ),
  );
  // Let the `showBead` fetch inside useBeadDetail settle.
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

/**
 * React tracks a controlled input/textarea's value through the *instance*
 * property it installs over the native prototype setter, so assigning
 * `el.value = x` directly leaves React's tracker thinking nothing changed —
 * the subsequent `input` event is then a no-op. Going through the prototype
 * setter first (the same trick React Testing Library's `fireEvent` uses) is
 * what makes the change visible to React's synthetic `onChange`.
 */
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function sectionFor(root: HTMLDivElement, heading: string): HTMLElement {
  const h3 = [...root.querySelectorAll('h3')].find((el) => el.textContent?.includes(heading));
  const section = h3?.closest('section');
  if (!section) throw new Error(`section "${heading}" not found`);
  return section;
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement {
  const button = [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

describe('EditableText (description/design/acceptance)', () => {
  it('renders a ghost "Add …" button when the field is empty', async () => {
    const root = await mount(bead({ description: undefined }));
    const section = sectionFor(root, 'Description');

    expect(section.textContent).toContain('Add description…');
    expect(section.querySelector('textarea')).toBeNull();
  });

  it('also renders ghost buttons for empty design and acceptance criteria', async () => {
    const root = await mount(bead({ design: '', acceptance_criteria: undefined }));

    expect(sectionFor(root, 'Design').textContent).toContain('Add design…');
    expect(sectionFor(root, 'Acceptance criteria').textContent).toContain(
      'Add acceptance criteria…',
    );
  });

  it('shows existing text read-only, with a pencil to edit it', async () => {
    const root = await mount(bead({ description: 'Existing description text' }));
    const section = sectionFor(root, 'Description');

    expect(section.textContent).toContain('Existing description text');
    expect(section.querySelector('textarea')).toBeNull();
    expect(section.querySelector('button[aria-label="Edit Description"]')).not.toBeNull();
  });

  it('edit -> preview -> save sends the draft through updateText', async () => {
    const root = await mount(bead({ description: 'Old text' }));
    const section = sectionFor(root, 'Description');

    await act(async () =>
      section.querySelector<HTMLButtonElement>('button[aria-label="Edit Description"]')?.click(),
    );

    const textarea = section.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea not found');
    await act(async () => typeInto(textarea, '**New** design text'));

    // Preview renders through the Markdown component, not the raw source.
    await act(async () => buttonByText(section, 'Preview').click());
    expect(section.querySelector('textarea')).toBeNull();
    expect(section.querySelector('strong')?.textContent).toBe('New');

    await act(async () => buttonByText(section, 'Save').click());

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('updateText');
    expect(rpc.calls[0].params).toEqual({
      id: 'bd-1',
      field: 'description',
      text: '**New** design text',
    });

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });

    // Back to read-only mode; no textarea left mounted.
    expect(sectionFor(root, 'Description').querySelector('textarea')).toBeNull();
  });

  it('Escape cancels the edit without closing the pane', async () => {
    const onCloseSpy = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    const subject = bead({ description: 'Untouched' });
    await act(async () =>
      mountedRoot?.render(
        createElement(BeadDetail, {
          bead: subject,
          beads: [subject],
          index,
          onClose: onCloseSpy,
          onSelect: vi.fn(),
          refreshKey: 0,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const section = sectionFor(container, 'Description');
    await act(async () =>
      section.querySelector<HTMLButtonElement>('button[aria-label="Edit Description"]')?.click(),
    );

    const textarea = section.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea not found');
    await act(async () => typeInto(textarea, 'abandon me'));

    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(rpc.calls).toHaveLength(0);
    expect(onCloseSpy).not.toHaveBeenCalled();
    // Cancel reverted to read-only mode showing the original text.
    const reverted = sectionFor(container, 'Description');
    expect(reverted.querySelector('textarea')).toBeNull();
    expect(reverted.textContent).toContain('Untouched');
  });

  it('Ctrl+Enter in the textarea also saves', async () => {
    const root = await mount(bead({ design: 'v1' }));
    const section = sectionFor(root, 'Design');

    await act(async () =>
      section.querySelector<HTMLButtonElement>('button[aria-label="Edit Design"]')?.click(),
    );
    const textarea = section.querySelector('textarea');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('textarea not found');
    await act(async () => typeInto(textarea, 'v2'));

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', field: 'design', text: 'v2' });
  });
});

describe('title inline edit', () => {
  it('pencil swaps the h2 for an input that commits on Enter', async () => {
    const root = await mount(bead());

    const pencil = root.querySelector<HTMLButtonElement>('button[aria-label="Edit title"]');
    if (!pencil) throw new Error('title pencil not found');
    await act(async () => pencil.click());

    const input = root.querySelector('input[aria-label="Edit title"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('title input not found');
    expect(input.value).toBe('Wire up EditableText');

    await act(async () => typeInto(input, 'Renamed title'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('updateText');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', field: 'title', text: 'Renamed title' });

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });
  });

  it('Escape cancels the title edit without closing the pane', async () => {
    const onCloseSpy = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    const subject = bead();
    await act(async () =>
      mountedRoot?.render(
        createElement(BeadDetail, {
          bead: subject,
          beads: [subject],
          index,
          onClose: onCloseSpy,
          onSelect: vi.fn(),
          refreshKey: 0,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const pencil = container.querySelector<HTMLButtonElement>('button[aria-label="Edit title"]');
    if (!pencil) throw new Error('title pencil not found');
    await act(async () => pencil.click());

    const input = container.querySelector('input[aria-label="Edit title"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('title input not found');
    await act(async () => typeInto(input, 'Should not save'));

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(rpc.calls).toHaveLength(0);
    expect(onCloseSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Wire up EditableText');
  });
});

describe('assignee field Escape-cancel (regression, bead li0.12)', () => {
  it('Escape reverts the draft and does not send it via setAssignee', async () => {
    const onCloseSpy = vi.fn();
    container = document.createElement('div');
    document.body.append(container);
    mountedRoot = createRoot(container);
    const subject = bead({ assignee: 'ana' });
    await act(async () =>
      mountedRoot?.render(
        createElement(BeadDetail, {
          bead: subject,
          beads: [subject],
          index,
          onClose: onCloseSpy,
          onSelect: vi.fn(),
          refreshKey: 0,
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="unassigned"]');
    if (!input) throw new Error('assignee input not found');
    expect(input.value).toBe('ana');

    await act(async () => typeInto(input, 'someone-else'));

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // The displayed value reverts immediately...
    expect(input.value).toBe('ana');
    // ...and the abandoned draft is never sent through setAssignee, even
    // though Escape does not blur the field (unlike the title editor, this
    // input has no unmount to hide it, so no explicit `.blur()` call is made
    // and a stale-closure commit would otherwise still fire synchronously).
    expect(rpc.calls).toHaveLength(0);
    expect(onCloseSpy).not.toHaveBeenCalled();

    // A later, ordinary blur against the now-reverted value is still a no-op
    // (commitAssignee's existing early return), confirming the field's
    // commit-on-blur behavior for unchanged values is unaffected.
    await act(async () => {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    expect(rpc.calls).toHaveLength(0);
  });

  it('commits normally on Enter (unaffected by the Escape fix)', async () => {
    const root = await mount(bead({ assignee: 'ana' }));

    const input = root.querySelector<HTMLInputElement>('input[placeholder="unassigned"]');
    if (!input) throw new Error('assignee input not found');

    // `.blur()` on the Enter branch is a jsdom no-op unless the element is
    // actually focused first (unlike the title input, this one has no
    // `autoFocus`).
    input.focus();
    await act(async () => typeInto(input, 'bob'));
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0].method).toBe('setAssignee');
    expect(rpc.calls[0].params).toEqual({ id: 'bd-1', assignee: 'bob' });

    await act(async () => {
      rpc.calls[0].resolve({ ok: true });
      await Promise.resolve();
    });
  });
});
