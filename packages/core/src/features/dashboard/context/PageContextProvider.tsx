'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { createContext, use, useCallback, useMemo, useState } from 'react';

/**
 * The record the current page is about, declared by the page and read by
 * the conversation surface (R4). One provider at the shell; pages call
 * `useRecordContext(ref)` (or render `<RecordContext record={…} />` from a
 * server component) to declare themselves; `PageDock` reads `record` and
 * sends it as `page_context.record` with every turn.
 *
 * A page that is not about one record can declare what it SHOWS instead
 * (`usePageView`, `<PageView … />` from a server component): its name and
 * a few label/value pairs — the Review queue's scope, tab, filters and
 * counts — sent as `page_context.title` and `.state`, so "these" in the
 * dock means what is on screen (2026-10-23: the dock beside the Review
 * queue knew only the path, and the agent called the queue "your inbox").
 *
 * Selection and @-mentions are per-request and travel from the affordance
 * that produced them, not here.
 */

/** What a page shows, as the dock sends it: its name and a few label/value pairs. */
export type PageView = { title: string; state: Array<{ label: string; value: string }> };

type PageContextValue = {
  record: RecordRef | null;
  setRecord: (ref: RecordRef | null) => void;
  view: PageView | null;
  setView: (view: PageView | null) => void;
};

const Ctx = createContext<PageContextValue | null>(null);

export function PageContextProvider(props: { children: React.ReactNode }) {
  const [record, setRecordState] = useState<RecordRef | null>(null);
  const [view, setViewState] = useState<PageView | null>(null);
  const setRecord = useCallback((ref: RecordRef | null) => {
    setRecordState(prev => (sameRef(prev, ref) ? prev : ref));
  }, []);
  const setView = useCallback((next: PageView | null) => {
    setViewState(prev => (viewKey(prev) === viewKey(next) ? prev : next));
  }, []);
  const value = useMemo(() => ({ record, setRecord, view, setView }), [record, setRecord, view, setView]);
  return <Ctx value={value}>{props.children}</Ctx>;
}

/** The current page record, or null. Safe outside the provider (returns nulls). */
export function usePageRecord(): PageContextValue {
  const v = use(Ctx);
  return v ?? { record: null, setRecord: () => {}, view: null, setView: () => {} };
}

/**
 * A view's identity, for "did it change". Pure.
 * @param view - The view, or null.
 */
export function viewKey(view: PageView | null): string {
  return view ? `${view.title}|${view.state.map(s => `${s.label}=${s.value}`).join('|')}` : '';
}

function sameRef(a: RecordRef | null, b: RecordRef | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.type === b.type && a.id === b.id && a.label === b.label && a.href === b.href;
}
