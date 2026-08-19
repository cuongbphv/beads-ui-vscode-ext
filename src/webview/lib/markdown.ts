/**
 * A hand-rolled, dependency-free markdown parser for the Fleet transcript's
 * `text`/`thinking` blocks. `parseMarkdown` returns a plain-data AST — no
 * HTML string, no React import — so the caller (`components/markdown.tsx`)
 * renders it as React elements directly. That is a deliberate security
 * property: the transcript is an agent/tool-controlled channel, so every
 * value that reaches an `InlineNode` here is a literal substring of the
 * input, never HTML-decoded. A future bug in one rule can produce
 * wrong-looking text; it structurally cannot produce live markup, because
 * nothing in this file ever builds an HTML string.
 *
 * Deliberately out of scope, matching the pasted reference this was modeled
 * on: `[text](url)` links never become clickable, bold/italic are
 * asterisk-only and never nest, and 5+ leading "#" characters are not a
 * heading at all.
 */

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'passfail'; value: string; kind: 'pass' | 'fail' };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; inline: InlineNode[] }
  | { type: 'paragraph'; lines: InlineNode[][] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][][] }
  | { type: 'code'; lang: string; lines: string[] }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'hr' };

const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const HR_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_RE = /^```(\w*)\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Every character reaching an `InlineNode` is a literal substring — see the module comment. */
const INLINE_TOKEN_RE =
  /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|((?:[✓✗]\s)?\b(?:PASS|PASSED|FAIL|FAILED)\b)/g;

function tokenizeInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push({ type: 'text', value: text.slice(lastIndex, index) });

    if (match[1] !== undefined) {
      nodes.push({ type: 'code', value: match[2] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: 'bold', value: match[4] });
    } else if (match[5] !== undefined) {
      nodes.push({ type: 'italic', value: match[6] });
    } else if (match[7] !== undefined) {
      nodes.push({ type: 'passfail', value: match[7], kind: match[7].includes('PASS') ? 'pass' : 'fail' });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: 'text', value: text.slice(lastIndex) });
  return nodes;
}

/** Splits a table row on unescaped `|`, trimming a leading/trailing empty cell from outer pipes. */
function splitTableRow(line: string): InlineNode[][] {
  const cells = line.split('|').map((cell) => cell.trim());
  if (cells.length > 0 && cells[0] === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells.map(tokenizeInline);
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(4, heading[1].length + 1) as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, inline: tokenizeInline(heading[2]) });
      i += 1;
      continue;
    }

    if (HR_RE.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const lang = fence[1];
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      // Either a closing ``` was found (skip it) or input ran out — an
      // unterminated fence still closes as a valid code block, per the
      // truncation caps upstream that can cut a transcript mid-fence.
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', lang, lines: codeLines });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // skip the header row and the separator row
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    const listItem = LIST_ITEM_RE.exec(line);
    if (listItem) {
      const ordered = /^\d+\.$/.test(listItem[2]);
      const items: InlineNode[][][] = [];
      while (i < lines.length) {
        const current = LIST_ITEM_RE.exec(lines[i]);
        if (current && /^\d+\.$/.test(current[2]) === ordered) {
          items.push([tokenizeInline(current[3])]);
          i += 1;
          // Indented, non-blank, non-marker lines right after a marker line
          // are that item's continuation lines.
          while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            /^\s+\S/.test(lines[i]) &&
            !LIST_ITEM_RE.test(lines[i])
          ) {
            items[items.length - 1].push(tokenizeInline(lines[i].trim()));
            i += 1;
          }
        } else {
          break;
        }
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume consecutive non-blank lines that don't start a
    // different block type.
    const paragraphLines: InlineNode[][] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i].trim()) &&
      !FENCE_RE.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i])
    ) {
      paragraphLines.push(tokenizeInline(lines[i]));
      i += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}
