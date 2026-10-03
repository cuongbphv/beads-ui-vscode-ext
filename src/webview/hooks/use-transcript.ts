/** Live transcript with bounded, on-demand history pages. */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { TranscriptEvent } from '../../shared/fleet';
import { asRpcError, call, onHostEvent } from '../bridge/rpc';

export interface TranscriptState {
  events: TranscriptEvent[];
  truncated: boolean;
  degraded: boolean;
  loading: boolean;
  error: string | null;
  loadingOlder: boolean;
  olderError: string | null;
  loadOlder: () => Promise<void>;
}

export function useTranscript(targetId: string): TranscriptState {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const cursor = useRef(0);
  const generation = useRef(0);
  const pageInFlight = useRef(false);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    let live = true;
    let subscribed = false;
    const pending: TranscriptEvent[] = [];
    cursor.current = 0;
    pageInFlight.current = false;
    setEvents([]);
    setTruncated(false);
    setDegraded(false);
    setLoading(true);
    setLoadingOlder(false);
    setError(null);
    setOlderError(null);

    const unsubscribeEvents = onHostEvent((event) => {
      if (!live || event.name !== 'transcriptAppend' || event.targetId !== targetId) return;
      if (subscribed) setEvents((previous) => previous.concat(event.events));
      else pending.push(...event.events);
      if (event.degraded) setDegraded(true);
    });

    void call('subscribeTranscript', { targetId })
      .then((backfill) => {
        if (!live || generation.current !== currentGeneration) return;
        cursor.current = backfill.beforeOffset ?? 0;
        setEvents(backfill.events.concat(pending));
        subscribed = true;
        setTruncated(backfill.truncated);
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
      ++generation.current;
      unsubscribeEvents();
      void call('unsubscribeTranscript', { targetId }).catch(() => {});
    };
  }, [targetId]);

  const loadOlder = useCallback(async () => {
    if (pageInFlight.current || cursor.current <= 0) return;
    pageInFlight.current = true;
    const currentGeneration = generation.current;
    const beforeOffset = cursor.current;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await call('getTranscriptPage', { targetId, beforeOffset });
      if (generation.current !== currentGeneration) return;
      cursor.current = page.beforeOffset;
      setEvents((current) => page.events.concat(current));
      setTruncated(page.hasOlder);
      if (page.degraded) setDegraded(true);
    } catch (rejection: unknown) {
      if (generation.current === currentGeneration) setOlderError(asRpcError(rejection).message);
    } finally {
      if (generation.current === currentGeneration) {
        pageInFlight.current = false;
        setLoadingOlder(false);
      }
    }
  }, [targetId]);

  return { events, truncated, degraded, loading, error, loadingOlder, olderError, loadOlder };
}
