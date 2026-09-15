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
 * Deliberately tiny: a record ref and a setter. Selection and @-mentions are
 * per-request and travel from the affordance that produced them, not here.
 */

type PageContextValue = {
  record: RecordRef | null;
  setRecord: (ref: RecordRef | null) => void;
};

const Ctx = createContext<PageContextValue | null>(null);

export function PageContextProvider(props: { children: React.ReactNode }) {
  const [record, setRecordState] = useState<RecordRef | null>(null);
  const setRecord = useCallback((ref: RecordRef | null) => {
    setRecordState(prev => (sameRef(prev, ref) ? prev : ref));
  }, []);
  const value = useMemo(() => ({ record, setRecord }), [record, setRecord]);
  return <Ctx value={value}>{props.children}</Ctx>;
}

/** The current page record, or null. Safe outside the provider (returns nulls). */
export function usePageRecord(): PageContextValue {
  const v = use(Ctx);
  return v ?? { record: null, setRecord: () => {} };
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
