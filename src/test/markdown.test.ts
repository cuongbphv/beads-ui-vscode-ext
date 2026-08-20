import { describe, expect, it } from 'vitest';

import { parseMarkdown, type InlineNode } from '../webview/lib/markdown';

describe('parseMarkdown — headings', () => {
  it('parses "# Title" as a level-2 heading (shifted down one from level 1)', () => {
    const blocks = parseMarkdown('# Title');
    expect(blocks).toEqual([{ type: 'heading', level: 2, inline: [{ type: 'text', value: 'Title' }] }]);
  });

  it('caps a level-4 "####" heading at level 4, not level 5', () => {
    const blocks = parseMarkdown('#### Deep');
    expect(blocks).toEqual([{ type: 'heading', level: 4, inline: [{ type: 'text', value: 'Deep' }] }]);
  });

  it('falls through to a plain paragraph for 5 or more leading "#" characters', () => {
    const blocks = parseMarkdown('##### Not a heading');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: '##### Not a heading' }]] },
    ]);
  });
});

describe('parseMarkdown — paragraphs', () => {
  it('joins consecutive non-blank lines into one paragraph with one entry per line', () => {
    const blocks = parseMarkdown('line one\nline two');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        lines: [[{ type: 'text', value: 'line one' }], [{ type: 'text', value: 'line two' }]],
      },
    ]);
  });

  it('splits into separate paragraphs across a blank line', () => {
    const blocks = parseMarkdown('first\n\nsecond');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'first' }]] },
      { type: 'paragraph', lines: [[{ type: 'text', value: 'second' }]] },
    ]);
  });
});

describe('parseMarkdown — hr', () => {
  it.each(['---', '***', '___'])('parses %s on its own line as a horizontal rule', (marker) => {
    const blocks = parseMarkdown(`above\n\n${marker}\n\nbelow`);
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'above' }]] },
      { type: 'hr' },
      { type: 'paragraph', lines: [[{ type: 'text', value: 'below' }]] },
    ]);
  });
});

describe('parseMarkdown — lists', () => {
  it('parses a bullet list with an indented continuation line on one item', () => {
    const blocks = parseMarkdown('- first item\n  still first item\n- second item');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [
          [[{ type: 'text', value: 'first item' }], [{ type: 'text', value: 'still first item' }]],
          [[{ type: 'text', value: 'second item' }]],
        ],
      },
    ]);
  });

  it('parses an ordered list distinctly from a bullet list', () => {
    const blocks = parseMarkdown('1. first\n2. second');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [[[{ type: 'text', value: 'first' }]], [[{ type: 'text', value: 'second' }]]],
      },
    ]);
  });
});

describe('parseMarkdown — tables', () => {
  it('parses a header, a separator row, and body rows into a table block', () => {
    const source = '| A | B |\n| - | - |\n| 1 | 2 |';
    const blocks = parseMarkdown(source);
    expect(blocks).toEqual([
      {
        type: 'table',
        header: [[{ type: 'text', value: 'A' }], [{ type: 'text', value: 'B' }]],
        rows: [[[{ type: 'text', value: '1' }], [{ type: 'text', value: '2' }]]],
      },
    ]);
  });
});

describe('parseMarkdown — code fences', () => {
  it('parses a fenced code block with a language tag, closed normally', () => {
    const source = '```ts\nconst x = 1;\nconst y = 2;\n```';
    const blocks = parseMarkdown(source);
    expect(blocks).toEqual([{ type: 'code', lang: 'ts', lines: ['const x = 1;', 'const y = 2;'] }]);
  });

  it('closes an unterminated fence at end-of-input instead of dropping the content', () => {
    const source = '```json\n{"truncated": tr';
    const blocks = parseMarkdown(source);
    expect(blocks).toEqual([{ type: 'code', lang: 'json', lines: ['{"truncated": tr'] }]);
  });
});

describe('parseMarkdown — inline tokens', () => {
  it('tokenizes inline code, bold and italic within one paragraph line', () => {
    const blocks = parseMarkdown('a `code` and **bold** and *italic* word');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        lines: [
          [
            { type: 'text', value: 'a ' },
            { type: 'code', value: 'code' },
            { type: 'text', value: ' and ' },
            { type: 'bold', value: 'bold' },
            { type: 'text', value: ' and ' },
            { type: 'italic', value: 'italic' },
            { type: 'text', value: ' word' },
          ],
        ],
      },
    ]);
  });

  it.each(['PASS', 'PASSED', 'FAIL', 'FAILED'])('tokenizes the exact word "%s" as passfail', (word) => {
    const blocks = parseMarkdown(`Result: ${word}`);
    const line = (blocks[0] as { type: 'paragraph'; lines: InlineNode[][] }).lines[0];
    expect(line).toEqual([
      { type: 'text', value: 'Result: ' },
      { type: 'passfail', value: word, kind: word.startsWith('PASS') ? 'pass' : 'fail' },
    ]);
  });

  it('does not tokenize lowercase "pass"/"fail" as passfail', () => {
    const blocks = parseMarkdown('this test did not pass or fail');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: 'this test did not pass or fail' }]] },
    ]);
  });

  it('includes the "✓ "/"✗ " prefix in the passfail token value when present', () => {
    const blocks = parseMarkdown('✓ PASSED');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: [[{ type: 'passfail', value: '✓ PASSED', kind: 'pass' }]] },
    ]);
  });
});
