/**
 * One transcript target's data (Fleet P4): subscribes for `targetId` on
 * mount and whenever it changes, unsubscribes the previous target first, and
 * keeps a rolling window of the most recent `MAX_TRANSCRIPT_EVENTS` events.
 *
 * Every `transcriptAppend` event is filtered by `event.targetId === targetId`
 * before it touches state — switching the selected worker/session must never
 * let a stale event meant for the previous target bleed into the new view.
 * This is on top of (not instead of) the extension host's own `TranscriptTailer`
 * only ever running one tail at a time; this hook's own subscription can also
 * change out from under a slow-to-settle host round trip, so the `live` guard
 * below (same pattern as `use-fleet.ts`) matters independently of that.
 */
import { useEffect, useRef, useState } from 'react';

import type { TranscriptEvent } from '../../shared/fleet';
import { asRpcError, call, onHostEvent } from '../bridge/rpc';

/** The rolling window's cap — older events are dropped once this is exceeded. */
export const MAX_TRANSCRIPT_EVENTS = 500;

export interface TranscriptState {
  /** The most recent events for this target, oldest first, capped at `MAX_TRANSCRIPT_EVENTS`. */
  events: TranscriptEvent[];
  /** True once older history has been dropped — either the backfill window or the rolling window. */
  truncated: boolean;
  /** True once the host has signalled a schema-drift batch for this subscription. */
  degraded: boolean;
  /** True only until the initial `subscribeTranscript` round trip settles. */
  loading: boolean;
  /** Set when `subscribeTranscript` rejected (an unknown target, a refused path, ...). */
  error: string | null;
}

export function useTranscript(targetId: string): TranscriptState {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Total events ever seen for the *current* subscription — how the window's own truncation is detected. */
  const totalSeenRef = useRef(0);

  useEffect(() => {
    let live = true;
    totalSeenRef.current = 0;
    setEvents([]);
    setTruncated(false);
    setDegraded(false);
    setLoading(true);
    setError(null);

    const unsubscribeEvents = onHostEvent((event) => {
      if (event.name !== 'transcriptAppend') return;
      if (event.targetId !== targetId) return; // never let a stale target's event through
      if (!live) return;

      totalSeenRef.current += event.events.length;
      setEvents((previous) => {
        const merged = previous.concat(event.events);
        return merged.length > MAX_TRANSCRIPT_EVENTS
          ? merged.slice(merged.length - MAX_TRANSCRIPT_EVENTS)
          : merged;
      });
      if (totalSeenRef.current > MAX_TRANSCRIPT_EVENTS) setTruncated(true);
      if (event.degraded) setDegraded(true);
    });

    void call('subscribeTranscript', { targetId })
      .then((backfill) => {
        if (!live) return;
        totalSeenRef.current += backfill.events.length;
        const windowed =
          backfill.events.length > MAX_TRANSCRIPT_EVENTS
            ? backfill.events.slice(backfill.events.length - MAX_TRANSCRIPT_EVENTS)
            : backfill.events;
        setEvents(windowed);
        if (backfill.truncated || backfill.events.length > MAX_TRANSCRIPT_EVENTS) setTruncated(true);
        if (backfill.degraded) setDegraded(true);
        setLoading(false);
      })
      .catch((rejection: unknown) => {
        if (!live) return;
        setError(asRpcError(rejection).message);
        setLoading(false);
      });

    return () => {
      live = false;
      unsubscribeEvents();
      void call('unsubscribeTranscript', { targetId }).catch(() => {
        // Nothing to recover: the view moved on (unmounted or switched targets)
        // regardless of whether the host heard the goodbye.
      });
    };
  }, [targetId]);

  return { events, truncated, degraded, loading, error };
}
