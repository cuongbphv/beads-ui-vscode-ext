// @vitest-environment jsdom

/**
 * `Transcript`: `text` blocks render as plain `pre-wrap` (no markdown lib —
 * CLAUDE.md's UI rules), `thinking`/`tool_use`/`tool_result` blocks render as
 * collapsed chips that expand on click, the truncated/degraded banners show
 * only when the hook says so, and the follow-mode toggle exposes
 * `aria-pressed`. `useTranscript` itself is mocked — this file is purely
 * about what `Transcript` does with whatever the hook returns.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { TranscriptEvent } from '../shared/fleet';
import type { TranscriptState } from '../webview/hooks/use-transcript';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const hookState = vi.hoisted(() => ({
  current: undefined as unknown as TranscriptState,
}));

vi.mock('../webview/hooks/use-transcript', () => ({
  useTranscript: () => hookState.current,
  MAX_TRANSCRIPT_EVENTS: 500,
}));

const { Transcript } = await import('../webview/components/fleet/transcript');

function makeEvent(overrides: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    uuid: 'e-1',
    role: 'assistant',
    timestamp: null,
    agentId: null,
    sessionId: null,
    blocks: [],
    ...overrides,
  };
}

function baseState(overrides: Partial<TranscriptState> = {}): TranscriptState {
  return {
    events: [],
    truncated: false,
    degraded: false,
    loading: false,
    error: null,
    ...overrides,
  };
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

async function render(state: TranscriptState): Promise<HTMLElement> {
  hookState.current = state;
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Transcript, { targetId: 'agent:worker-1' })));
  return container;
}

describe('Transcript — loading/error/empty', () => {
  it('shows a loading state', async () => {
    const el = await render(baseState({ loading: true }));
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('shows an error state without throwing', async () => {
    const el = await render(baseState({ error: 'Unknown transcript target: agent:ghost' }));
    expect(el.textContent).toMatch(/unknown transcript target/i);
  });

  it('shows an empty state when there are no events', async () => {
    const el = await render(baseState());
    expect(el.textContent?.toLowerCase()).toContain('no transcript');
  });
});

describe('Transcript — blocks', () => {
  it('renders a text block through the markdown renderer — "**bold**" becomes a real <strong> (reverses the prior plain-text decision, 2026-08-20)', async () => {
    const event = makeEvent({
      blocks: [{ type: 'text', text: 'plain **bold** text', truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const strong = el.querySelector('strong');
    expect(strong?.textContent).toBe('bold');
    expect(el.textContent).toContain('plain');
    expect(el.textContent).toContain('bold');
    expect(el.textContent).toContain('text');
  });

  it('renders a thinking block through the markdown renderer too', async () => {
    const event = makeEvent({
      blocks: [{ type: 'thinking', thinking: 'let **me** think', truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const details = el.querySelector('details') as HTMLElement;
    expect(details.querySelector('strong')?.textContent).toBe('me');
  });

  it('keeps a tool_use block as plain pre-wrap text — markdown does not apply to it', async () => {
    const event = makeEvent({
      blocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: '**not markdown**', truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const details = el.querySelector('details') as HTMLElement;
    expect(details.querySelector('strong')).toBeNull();
    expect(details.textContent).toContain('**not markdown**');
  });

  it('renders a thinking block collapsed by default, as a <details> chip', async () => {
    const event = makeEvent({
      blocks: [{ type: 'thinking', thinking: 'reasoning content', truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const details = el.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain('reasoning content'); // present in the DOM even collapsed
  });

  it('expands a chip on click (toggling the native <details> open state)', async () => {
    const event = makeEvent({
      blocks: [{ type: 'tool_use', id: 't1', name: 'Read', input: '{"path":"a.ts"}', truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const summary = el.querySelector('summary') as HTMLElement;
    expect(summary).toBeTruthy();
    await act(async () => summary.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));

    const details = el.querySelector('details');
    expect(details?.open).toBe(true);
  });

  it('renders a tool_result chip and labels an error result distinctly', async () => {
    const event = makeEvent({
      blocks: [{ type: 'tool_result', toolUseId: 't1', content: 'boom', isError: true, truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    expect(el.textContent?.toLowerCase()).toContain('error');
  });
});

describe('Transcript — block colour (beads-ui-vscode-ext-w9a color upgrade)', () => {
  // Each chip type gets its own theme-derived `--chip-color`, drawn from the
  // same `--color-chart-*` set Board/Roadmap already use — never a fixed hex
  // — so a scan down the transcript tells `thinking` apart from `tool_use`
  // apart from `tool_result` without opening every chip.
  it.each([
    ['thinking', { type: 'thinking', thinking: 'reasoning', truncated: false }, 'var(--color-chart-purple)'],
    ['tool_use', { type: 'tool_use', id: 't1', name: 'Read', input: '{}', truncated: false }, 'var(--color-chart-blue)'],
    [
      'tool_result (ok)',
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, truncated: false },
      'var(--color-chart-green)',
    ],
  ] as const)('gives a %s chip its own --chip-color', async (_label, block, expectedColor) => {
    const event = makeEvent({ blocks: [block] });
    const el = await render(baseState({ events: [event] }));

    const details = el.querySelector('details') as HTMLElement;
    expect(details.style.getPropertyValue('--chip-color')).toBe(expectedColor);
  });

  it("overrides a tool_result chip's colour to --color-danger when it errored, not its usual chart colour", async () => {
    const event = makeEvent({
      blocks: [{ type: 'tool_result', toolUseId: 't1', content: 'boom', isError: true, truncated: false }],
    });
    const el = await render(baseState({ events: [event] }));

    const details = el.querySelector('details') as HTMLElement;
    expect(details.style.getPropertyValue('--chip-color')).toBe('var(--color-danger)');
  });

  it('gives an assistant turn the accent colour and a user turn the neutral muted colour', async () => {
    const el = await render(
      baseState({
        events: [
          makeEvent({ role: 'assistant', blocks: [{ type: 'text', text: 'hi', truncated: false }] }),
          makeEvent({ role: 'user', blocks: [{ type: 'text', text: 'hi', truncated: false }] }),
        ],
      }),
    );

    const roleLabels = Array.from(el.querySelectorAll('li > span')).filter((span) =>
      ['user', 'assistant'].includes(span.textContent ?? ''),
    );
    expect(roleLabels).toHaveLength(2);
    expect(roleLabels[0]?.className).toContain('text-accent');
    expect(roleLabels[1]?.className).toContain('text-fg-muted');
  });
});

describe('Transcript — banners', () => {
  it('shows the truncated banner only when truncated is true', async () => {
    const event = makeEvent({ blocks: [{ type: 'text', text: 'hi', truncated: false }] });
    const withBanner = await render(baseState({ events: [event], truncated: true }));
    expect(withBanner.textContent?.toLowerCase()).toContain('truncated');

    const withoutBanner = await render(baseState({ events: [event], truncated: false }));
    expect(withoutBanner.textContent?.toLowerCase()).not.toContain('truncated');
  });

  it('shows the degraded banner only when degraded is true', async () => {
    const event = makeEvent({ blocks: [{ type: 'text', text: 'hi', truncated: false }] });
    const withBanner = await render(baseState({ events: [event], degraded: true }));
    expect(withBanner.textContent?.toLowerCase()).toMatch(/parse|degraded|incomplete/);

    const withoutBanner = await render(baseState({ events: [event], degraded: false }));
    expect(withoutBanner.textContent?.toLowerCase()).not.toMatch(/could not be parsed/);
  });
});

describe('Transcript — follow mode toggle', () => {
  it('exposes aria-pressed reflecting follow state, defaulting to following', async () => {
    const event = makeEvent({ blocks: [{ type: 'text', text: 'hi', truncated: false }] });
    const el = await render(baseState({ events: [event] }));

    const button = el.querySelector('button[aria-pressed]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles aria-pressed to false on click', async () => {
    const event = makeEvent({ blocks: [{ type: 'text', text: 'hi', truncated: false }] });
    const el = await render(baseState({ events: [event] }));

    const button = el.querySelector('button[aria-pressed]') as HTMLButtonElement;
    await act(async () => button.click());

    expect(button.getAttribute('aria-pressed')).toBe('false');
  });
});
