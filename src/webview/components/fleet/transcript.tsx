/**
 * The Fleet tab's transcript viewer (Fleet P4): one target's `user`/
 * `assistant` events, streamed live from `useTranscript`.
 *
 * `text` and `thinking` blocks render through `<Markdown>` (`components/
 * markdown.tsx`) — a hand-rolled, dependency-free renderer that parses to a
 * plain-data AST and renders React elements directly, never
 * `dangerouslySetInnerHTML`, because this content is an agent/tool-
 * controlled channel. `tool_use`/`tool_result` blocks stay plain
 * `whitespace-pre-wrap` text — markdown has no meaning in a JSON blob or a
 * command's raw output, and running it through the renderer would corrupt
 * the very content a reader needs verbatim. `thinking`/`tool_use`/
 * `tool_result` blocks render as collapsed `<details>` chips: the native
 * disclosure widget gives click-to-expand and correct assistive-tech
 * semantics for free, without hand-rolled `aria-expanded` bookkeeping.
 *
 * Follow mode auto-scrolls to the bottom while the reader is within
 * `FOLLOW_THRESHOLD_PX` of it (`isNearBottom`/`nextScrollTop` from
 * `transcript-scroll.ts`, shared with whatever P1 already built) and stops
 * the instant they scroll up — the toggle button exposes its state via
 * `aria-pressed` rather than colour alone.
 *
 * Purely presentational: every value here already arrived through
 * `useTranscript` via the RPC bridge. No `child_process`, filesystem, or
 * network access from this file.
 */
import { AlertTriangle, Bot, Brain, Search, ScrollText, Terminal, Wrench } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { TranscriptBlock, TranscriptEvent } from '../../../shared/fleet';
import { useTranscript } from '../../hooks/use-transcript';
import { isNearBottom, nextScrollTop } from '../../lib/transcript-scroll';
import { cn } from '../../lib/utils';
import { Markdown } from '../markdown';
import { EmptyState, Skeleton } from '../primitives';

/** Within this many px of the bottom counts as "following" — matches `isNearBottom`'s own default. */
const FOLLOW_THRESHOLD_PX = 40;

export function Transcript({ targetId }: { targetId: string }): ReactNode {
  const { events, truncated, degraded, loading, error, loadingOlder, olderError, loadOlder } = useTranscript(targetId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousScrollHeight = useRef(0);
  const prependAnchor = useRef<{ top: number; height: number } | null>(null);
  const [following, setFollowing] = useState(true);
  const [query, setQuery] = useState('');
  const visibleEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? events.filter((event) => eventSearchText(event).includes(needle)) : events;
  }, [events, query]);

  useEffect(() => {
    setQuery('');
    setFollowing(true);
    prependAnchor.current = null;
    previousScrollHeight.current = 0;
  }, [targetId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nextHeight = el.scrollHeight;
    if (prependAnchor.current) {
      el.scrollTop = prependAnchor.current.top + nextHeight - prependAnchor.current.height;
      prependAnchor.current = null;
    } else {
      el.scrollTop = nextScrollTop({
        following: following && !query,
        scrollTop: el.scrollTop,
        previousScrollHeight: previousScrollHeight.current,
        nextScrollHeight: nextHeight,
        clientHeight: el.clientHeight,
      });
    }
    previousScrollHeight.current = nextHeight;
    // Deliberately only depends on `events`: this effect exists to react to
    // new content arriving, using whatever `following` is *at that moment*.
    // A manual toggle with no new content is handled by the button itself.
  }, [visibleEvents]);

  useEffect(() => {
    if (olderError) prependAnchor.current = null;
  }, [olderError]);

  async function showOlder(): Promise<void> {
    const el = scrollRef.current;
    if (el) prependAnchor.current = { top: el.scrollTop, height: el.scrollHeight };
    setFollowing(false);
    await loadOlder();
  }

  function jumpLatest(): void {
    setQuery('');
    setFollowing(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  }

  function handleScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    setFollowing(isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight, FOLLOW_THRESHOLD_PX));
  }

  function toggleFollowing(): void {
    setFollowing((current) => {
      const next = !current;
      const el = scrollRef.current;
      if (next && el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="grid gap-2 p-3" aria-busy="true" aria-label="Loading transcript">
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
        <Skeleton className="h-10 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-10" />}
        title="Transcript unavailable"
        hint={error}
      />
    );
  }

  if (events.length === 0 && !truncated) {
    return (
      <EmptyState
        icon={<Bot className="size-10" />}
        title="No transcript activity yet"
        hint="Waiting for this target's first event."
      />
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="border-border flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <label className="text-fg-muted flex min-w-40 flex-1 items-center gap-1.5 text-xs">
          <Search aria-hidden="true" className="size-3.5" />
          <input
            type="search"
            aria-label="Search loaded transcript"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search loaded events"
            className="bg-surface min-w-0 flex-1 rounded border px-2 py-1"
          />
        </label>
        {query ? <span className="text-fg-muted text-xs">{visibleEvents.length} matches in loaded events</span> : null}
      </div>
      {truncated || degraded ? (
        <div className="border-border bg-surface-hover text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
          {truncated ? <span>Older history is available.</span> : null}
          {degraded ? (
            <span className="text-warning inline-flex items-center gap-1">
              <AlertTriangle aria-hidden="true" className="size-3" />
              Some lines could not be parsed — this view may be incomplete.
            </span>
          ) : null}
        </div>
      ) : null}

      {truncated ? (
        <div className="border-border flex items-center gap-2 border-b px-3 py-1.5">
          <button type="button" disabled={loadingOlder} onClick={() => void showOlder()} className="surface-interactive rounded-md px-2 py-1 text-xs">
            {loadingOlder ? 'Loading older events…' : 'Load older events'}
          </button>
          {olderError ? <span role="alert" className="text-danger text-xs">{olderError}</span> : null}
        </div>
      ) : null}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-3">
          {visibleEvents.map((event, index) => (
            <TranscriptEventRow key={event.uuid ?? index} event={event} />
          ))}
        </ul>
        {query && visibleEvents.length === 0 ? <p className="text-fg-muted text-xs">No matches in loaded events.</p> : null}
      </div>

      <div className="border-border flex items-center justify-end gap-2 border-t px-3 py-1.5">
        <button type="button" onClick={jumpLatest} className="surface-interactive rounded-md px-2 py-1 text-xs">
          Latest
        </button>
        <button
          type="button"
          aria-pressed={following}
          onClick={toggleFollowing}
          title={following ? 'Following new events' : 'Not following — click to jump to the bottom'}
          className={cn(
            'surface-interactive inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs',
            following ? 'text-fg' : 'text-fg-muted',
          )}
        >
          <ScrollText aria-hidden="true" className="size-3.5" />
          {following ? 'Following' : 'Follow'}
        </button>
      </div>
    </div>
  );
}

function eventSearchText(event: TranscriptEvent): string {
  return event.blocks.map((block) => {
    switch (block.type) {
      case 'text': return block.text;
      case 'thinking': return block.thinking;
      case 'tool_use': return `${block.name} ${block.input}`;
      case 'tool_result': return block.content;
    }
  }).join(' ').toLocaleLowerCase();
}

/**
 * `assistant` gets the theme's own link/accent hue — the same colour the
 * editor already uses for "this is the active, clickable thing" — so a
 * scan down the transcript separates the agent's turns from the operator's
 * without reading every label. `user`/`other` stay neutral: the human's own
 * words are the reason the transcript exists and don't need to compete for
 * attention.
 */
const ROLE_CLASS: Record<TranscriptEvent['role'], string> = {
  user: 'text-fg-muted',
  assistant: 'text-accent',
  other: 'text-fg-muted',
};

function TranscriptEventRow({ event }: { event: TranscriptEvent }): ReactNode {
  return (
    <li className="flex flex-col gap-1.5">
      <span className={cn('text-[0.65rem] font-medium tracking-wide uppercase', ROLE_CLASS[event.role])}>
        {event.role}
      </span>
      {event.blocks.map((block, index) => (
        <TranscriptBlockView key={index} block={block} />
      ))}
    </li>
  );
}

function TranscriptBlockView({ block }: { block: TranscriptBlock }): ReactNode {
  if (block.type === 'text') {
    return <Markdown source={block.text} />;
  }
  return <TranscriptChip block={block} />;
}

const CHIP_ICON: Record<Exclude<TranscriptBlock['type'], 'text'>, ReactNode> = {
  thinking: <Brain aria-hidden="true" className="size-3.5" />,
  tool_use: <Wrench aria-hidden="true" className="size-3.5" />,
  tool_result: <Terminal aria-hidden="true" className="size-3.5" />,
};

/**
 * One theme-derived hue per block type, borrowed from the same
 * `--color-chart-*` set Board/Roadmap already use for chart series — not a
 * new palette, just this view finally drawing from it. `tool_result` in its
 * error state overrides to `--color-danger` regardless of this map (see
 * `chipColor` below): a failed tool call is a danger signal, not a "this is
 * a tool result" one.
 */
const CHIP_COLOR: Record<Exclude<TranscriptBlock['type'], 'text'>, string> = {
  thinking: 'var(--color-chart-purple)',
  tool_use: 'var(--color-chart-blue)',
  tool_result: 'var(--color-chart-green)',
};

function chipColor(block: Exclude<TranscriptBlock, { type: 'text' }>): string {
  if (block.type === 'tool_result' && block.isError) return 'var(--color-danger)';
  return CHIP_COLOR[block.type];
}

function chipLabel(block: Exclude<TranscriptBlock, { type: 'text' }>): string {
  switch (block.type) {
    case 'thinking':
      return 'Thinking';
    case 'tool_use':
      return `Tool call: ${block.name || 'unnamed'}`;
    case 'tool_result':
      if (block.isError) return 'Tool result — error';
      return block.content.trim() ? 'Tool result' : 'Tool result — no output';
  }
}

function chipBody(block: Exclude<TranscriptBlock, { type: 'text' }>): string {
  switch (block.type) {
    case 'thinking':
      return block.thinking;
    case 'tool_use':
      return block.input;
    case 'tool_result':
      return block.content.trim() ? block.content : 'This tool call returned no text.';
  }
}

/** A collapsed-by-default disclosure for a `thinking`/`tool_use`/`tool_result` block. */
function TranscriptChip({ block }: { block: Exclude<TranscriptBlock, { type: 'text' }> }): ReactNode {
  return (
    <details
      className="transcript-chip rounded-md border text-xs"
      style={{ '--chip-color': chipColor(block) } as CSSProperties}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1">
        {CHIP_ICON[block.type]}
        {chipLabel(block)}
        {block.truncated ? <span className="text-fg-muted">(truncated)</span> : null}
      </summary>
      <div className="border-border text-fg border-t px-2 py-1.5">
        {block.type === 'thinking' ? (
          <Markdown source={block.thinking} />
        ) : (
          <div className="whitespace-pre-wrap">{chipBody(block)}</div>
        )}
      </div>
    </details>
  );
}
