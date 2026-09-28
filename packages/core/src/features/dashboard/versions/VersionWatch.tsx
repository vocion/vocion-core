'use client';

import type { SectionSnapshot, VersionWritten } from './versionEvents';
import type { RecordRef } from '@/services/chat/pageContext';
import { useEffect, useLayoutEffect, useRef, useTransition } from 'react';
import { useRouter } from '@/libs/I18nNavigation';
import { changedSections, markChanged, snapshotSections, useVersionWritten } from './versionEvents';

/**
 * Refetch a surface when a version of what it shows is written, and mark
 * what changed once the new content is on screen (backlog 035).
 *
 * The surface says how it refetches and when the refetch has landed
 * (`settled` changes, `ready` is true); this snapshots its regions before,
 * compares after, and marks the ones that changed. Scroll is the surface's
 * own — nothing here remounts or navigates.
 * @param opts - The surface.
 * @param opts.refs - What it shows.
 * @param opts.root - Its root element, read at the moment of use.
 * @param opts.refetch - Fetch the new content.
 * @param opts.settled - A value that changes when new content has rendered.
 * @param opts.ready - Whether the content on screen is the refetched one.
 */
export function useVersionRefresh(opts: {
  refs: ReadonlyArray<Pick<RecordRef, 'type' | 'id'>>;
  root: () => ParentNode | null;
  refetch: (v: VersionWritten) => void;
  settled: unknown;
  ready: boolean;
}): void {
  const pending = useRef<{ before: SectionSnapshot; fields: string[] } | null>(null);
  const root = useRef(opts.root);
  const refetch = useRef(opts.refetch);
  useLayoutEffect(() => {
    root.current = opts.root;
    refetch.current = opts.refetch;
  });
  useVersionWritten(opts.refs, (v) => {
    pending.current = { before: snapshotSections(root.current()), fields: v.fields ?? [] };
    refetch.current(v);
  });
  const { settled, ready } = opts;
  useEffect(() => {
    const p = pending.current;
    if (!p) {
      return;
    }
    // The first settle after the event can be the refetch STARTING (a
    // transition going pending); only a settle that is ready is the new content.
    if (!ready) {
      return;
    }
    pending.current = null;
    let clear: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      clear = markChanged(changedSections(root.current(), p.before, p.fields));
    });
    return () => {
      cancelAnimationFrame(frame);
      clear?.();
    };
  }, [settled, ready]);
}

/**
 * A server-rendered page that shows a record or an artifact: on a version of
 * it, `router.refresh()` in a transition (the server component re-renders in
 * place, scroll kept), then the changed regions are marked.
 * @param props - Component props.
 * @param props.refs - What the page shows.
 * @param props.root - CSS selector for the page's content (default: the whole document).
 */
export function VersionWatch({ refs, root }: { refs: ReadonlyArray<Pick<RecordRef, 'type' | 'id'>>; root?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  useVersionRefresh({
    refs,
    root: () => (typeof document === 'undefined' ? null : root ? document.querySelector(root) : document),
    refetch: () => startTransition(() => router.refresh()),
    settled: isPending,
    ready: !isPending,
  });
  return null;
}
