/**
 * Renders `parseMarkdown`'s plain-data AST as React elements — never
 * `dangerouslySetInnerHTML`. Every leaf value in the AST is a literal
 * substring of the source (see `lib/markdown.ts`'s module comment); handing
 * that string to React as a text child is what makes this safe against a
 * transcript that contains attacker-controlled markup: React never
 * interprets a text child as HTML, so there is no injection surface here to
 * introduce by editing this file, only wrong-looking (but always inert) text.
 *
 * No props beyond `source` — no `className`, no `onLinkClick`. Callers that
 * need layout control wrap this component, the same way `Transcript` already
 * wraps its own blocks in `<li>`/`<div>`.
 */
import { Fragment, type JSX, type ReactNode } from 'react';

import { type InlineNode, type MarkdownBlock, parseMarkdown } from '../lib/markdown';

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return node.value ? <Fragment key={key}>{node.value}</Fragment> : null;
      case 'bold':
        return <strong key={key}>{node.value}</strong>;
      case 'italic':
        return <em key={key}>{node.value}</em>;
      case 'code':
        return (
          <code key={key} className="border-border bg-surface-hover rounded border px-1 font-mono text-[0.85em]">
            {node.value}
          </code>
        );
      case 'passfail':
        return (
          <span key={key} className={node.kind === 'pass' ? 'text-success' : 'text-danger'}>
            {node.value}
          </span>
        );
    }
  });
}

/** `"key":` gets one colour, a string/number/bool/null value gets another — a naive, line-local tint. */
const JSON_TINT_RE = /("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/g;

function renderJsonLine(line: string, key: string): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let index = 0;
  for (const match of line.matchAll(JSON_TINT_RE)) {
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(<Fragment key={`${key}-t${index}`}>{line.slice(lastIndex, start)}</Fragment>);
    if (match[1] !== undefined) {
      parts.push(
        <span key={`${key}-k${index}`} data-md-json="key" style={{ color: 'var(--color-chart-blue)' }}>
          {match[1]}
        </span>,
      );
    } else if (match[2] !== undefined) {
      parts.push(
        <span key={`${key}-v${index}`} data-md-json="value" style={{ color: 'var(--color-chart-green)' }}>
          {match[2]}
        </span>,
      );
    }
    lastIndex = start + match[0].length;
    index += 1;
  }
  if (lastIndex < line.length) parts.push(<Fragment key={`${key}-tail`}>{line.slice(lastIndex)}</Fragment>);
  return parts;
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `b${index}`;
  switch (block.type) {
    case 'heading': {
      const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
      return <Tag key={key}>{renderInline(block.inline, key)}</Tag>;
    }
    case 'paragraph':
      return (
        <p key={key} className="text-fg text-sm">
          {block.lines.map((line, lineIndex) => (
            <Fragment key={`${key}-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line, `${key}-${lineIndex}`)}
            </Fragment>
          ))}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} className="text-fg text-sm">
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>
              {item.map((line, lineIndex) => (
                <Fragment key={`${key}-${itemIndex}-${lineIndex}`}>
                  {lineIndex > 0 ? <br /> : null}
                  {renderInline(line, `${key}-${itemIndex}-${lineIndex}`)}
                </Fragment>
              ))}
            </li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <div key={key} className="border-border bg-surface-hover rounded-md border font-mono text-xs">
          <div className="text-fg-muted border-border border-b px-2 py-1">
            {block.lang || 'text'} · {block.lines.length} line{block.lines.length === 1 ? '' : 's'}
          </div>
          <pre className="overflow-x-auto px-2 py-1.5">
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${key}-${lineIndex}`}>
                {lineIndex > 0 ? '\n' : null}
                {block.lang === 'json' ? renderJsonLine(line, `${key}-${lineIndex}`) : line}
              </Fragment>
            ))}
          </pre>
        </div>
      );
    case 'table':
      return (
        <table key={key} className="border-border text-fg text-sm">
          <thead>
            <tr>
              {block.header.map((cell, cellIndex) => (
                <th key={`${key}-h${cellIndex}`} className="border-border border px-2 py-1 text-left">
                  {renderInline(cell, `${key}-h${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}-r${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${key}-r${rowIndex}-${cellIndex}`} className="border-border border px-2 py-1">
                    {renderInline(cell, `${key}-r${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'hr':
      return <hr key={key} className="border-border" />;
  }
}

export function Markdown({ source }: { source: string }): ReactNode {
  return <>{parseMarkdown(source).map((block, index) => renderBlock(block, index))}</>;
}
