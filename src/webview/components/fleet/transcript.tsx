/**
 * The Fleet tab's transcript viewer (Fleet P4): one target's `user`/
 * `assistant` events, streamed live from `useTranscript`.
 *
 * `text` blocks render as plain `pre-wrap` text — no markdown rendering
 * library, per CLAUDE.md's UI rules — so a transcript containing literal
 * `**`/backticks/etc. is shown exactly as written. `thinking`/`tool_use`/
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
import { AlertTriangle, Bot, Brain, ScrollText, Terminal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { TranscriptBlock, TranscriptEvent } from '../../../shared/fleet';
import { MAX_TRANSCRIPT_EVENTS, useTranscript } from '../../hooks/use-transcript';
import { isNearBottom, nextScrollTop } from '../../lib/transcript-scroll';
import { cn } from '../../lib/utils';
import { EmptyState, Skeleton } from '../primitives';

/** Within this many px of the bottom counts as "following" — matches `isNearBottom`'s own default. */
const FOLLOW_THRESHOLD_PX = 40;

export function Transcript({ targetId }: { targetId: string }): ReactNode {
  const { events, truncated, degraded, loading, error } = useTranscript(targetId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousScrollHeight = useRef(0);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nextHeight = el.scrollHeight;
    el.scrollTop = nextScrollTop({
      following,
      scrollTop: el.scrollTop,
      previousScrollHeight: previousScrollHeight.current,
      nextScrollHeight: nextHeight,
      clientHeight: el.clientHeight,
    });
    previousScrollHeight.current = nextHeight;
    // Deliberately only depends on `events`: this effect exists to react to
    // new content arriving, using whatever `following` is *at that moment*.
    // A manual toggle with no new content is handled by the button itself.
  }, [events]);

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

  if (events.length === 0) {
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
      {truncated || degraded ? (
        <div className="border-border bg-surface-hover text-fg-muted flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
          {truncated ? <span>Truncated — showing the last {MAX_TRANSCRIPT_EVENTS} events.</span> : null}
          {degraded ? (
            <span className="text-warning inline-flex items-center gap-1">
              <AlertTriangle aria-hidden="true" className="size-3" />
              Some lines could not be parsed — this view may be incomplete.
            </span>
          ) : null}
        </div>
      ) : null}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-3">
          {events.map((event, index) => (
            <TranscriptEventRow key={event.uuid ?? index} event={event} />
          ))}
        </ul>
      </div>

      <div className="border-border flex items-center justify-end border-t px-3 py-1.5">
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

function TranscriptEventRow({ event }: { event: TranscriptEvent }): ReactNode {
  return (
    <li className="flex flex-col gap-1.5">
      <span className="text-fg-muted text-[0.65rem] font-medium tracking-wide uppercase">{event.role}</span>
      {event.blocks.map((block, index) => (
        <TranscriptBlockView key={index} block={block} />
      ))}
    </li>
  );
}

function TranscriptBlockView({ block }: { block: TranscriptBlock }): ReactNode {
  if (block.type === 'text') {
    return <p className="text-fg text-sm whitespace-pre-wrap">{block.text}</p>;
  }
  return <TranscriptChip block={block} />;
}

const CHIP_ICON: Record<Exclude<TranscriptBlock['type'], 'text'>, ReactNode> = {
  thinking: <Brain aria-hidden="true" className="size-3.5" />,
  tool_use: <Wrench aria-hidden="true" className="size-3.5" />,
  tool_result: <Terminal aria-hidden="true" className="size-3.5" />,
};

function chipLabel(block: Exclude<TranscriptBlock, { type: 'text' }>): string {
  switch (block.type) {
    case 'thinking':
      return 'Thinking';
    case 'tool_use':
      return `Tool call: ${block.name || 'unnamed'}`;
    case 'tool_result':
      return block.isError ? 'Tool result — error' : 'Tool result';
  }
}

function chipBody(block: Exclude<TranscriptBlock, { type: 'text' }>): string {
  switch (block.type) {
    case 'thinking':
      return block.thinking;
    case 'tool_use':
      return block.input;
    case 'tool_result':
      return block.content;
  }
}

/** A collapsed-by-default disclosure for a `thinking`/`tool_use`/`tool_result` block. */
function TranscriptChip({ block }: { block: Exclude<TranscriptBlock, { type: 'text' }> }): ReactNode {
  const isErrorResult = block.type === 'tool_result' && block.isError;
  return (
    <details className="border-border rounded-md border text-xs">
      <summary
        className={cn(
          'text-fg-muted hover:text-fg flex cursor-pointer list-none items-center gap-1.5 px-2 py-1',
          isErrorResult && 'text-danger',
        )}
      >
        {CHIP_ICON[block.type]}
        {chipLabel(block)}
        {block.truncated ? <span className="text-fg-muted">(truncated)</span> : null}
      </summary>
      <div className="border-border text-fg border-t px-2 py-1.5 whitespace-pre-wrap">{chipBody(block)}</div>
    </details>
  );
}
