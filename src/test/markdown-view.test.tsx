// @vitest-environment jsdom

/**
 * `<Markdown>` renders `parseMarkdown`'s AST as React elements — never
 * `dangerouslySetInnerHTML`. These tests cover the one behavior that lives
 * only in this file (the `json` code-block tint, which is render-time-only —
 * see `markdown.ts`'s module comment) and, since the transcript this feeds
 * is an agent/tool-controlled channel, dedicated injection-safety tests: a
 * hostile-looking string must always land as inert text, never as a real
 * `<script>`/`<img>` element or an `on*` attribute.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Markdown } from '../webview/components/markdown';

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

async function render(source: string): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.append(container);
  mounted = createRoot(container);
  await act(async () => mounted?.render(createElement(Markdown, { source })));
  return container;
}

describe('Markdown — JSON code-block tint', () => {
  it('wraps a JSON key and a string value in their own coloured spans', async () => {
    const el = await render('```json\n{"name": "ok"}\n```');
    const keySpan = el.querySelector('[data-md-json="key"]');
    const valueSpan = el.querySelector('[data-md-json="value"]');
    expect(keySpan?.textContent).toBe('"name":');
    expect(valueSpan?.textContent).toBe('"ok"');
  });

  it('does not tint a non-json code block', async () => {
    const el = await render('```ts\nconst x = 1;\n```');
    expect(el.querySelector('[data-md-json]')).toBeNull();
  });
});

describe('Markdown — basic block rendering', () => {
  it('renders a heading, a paragraph and a list as their own elements', async () => {
    const el = await render('# Title\n\nsome text\n\n- item one\n- item two');
    expect(el.querySelector('h2')?.textContent).toBe('Title');
    expect(el.querySelector('p')?.textContent).toBe('some text');
    expect(el.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('renders **bold** and *italic* as real <strong>/<em> elements', async () => {
    const el = await render('a **bold** and *italic* word');
    expect(el.querySelector('strong')?.textContent).toBe('bold');
    expect(el.querySelector('em')?.textContent).toBe('italic');
  });
});

describe('Markdown — injection safety', () => {
  it('renders a <script> tag as literal inert text, never a real script element', async () => {
    const el = await render('<script>alert(1)</script>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders an <img onerror> as literal text, never a real img element or onerror attribute', async () => {
    const el = await render('<img src=x onerror=alert(1)>');
    expect(el.querySelector('img')).toBeNull();
    // The escaped string still contains the substring "onerror=" as inert
    // text (`&lt;img ... onerror=alert(1)&gt;`) — that is expected and safe.
    // What must never happen is a real DOM node carrying the attribute.
    expect(Array.from(el.querySelectorAll('*')).some((node) => node.hasAttribute('onerror'))).toBe(false);
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('never turns [text](javascript:...) into a clickable link', async () => {
    const el = await render('[click me](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toContain('[click me](javascript:alert(1))');
  });

  it('renders a bare <div> tag as literal text, not a nested element', async () => {
    const el = await render('plain <div class="x"> text');
    expect(el.querySelector('div.x')).toBeNull();
    expect(el.textContent).toContain('plain <div class="x"> text');
  });
});
