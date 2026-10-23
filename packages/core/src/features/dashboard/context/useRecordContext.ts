'use client';

import type { PageView } from './PageContextProvider';
import type { RecordRef } from '@/services/chat/pageContext';
import { useEffect } from 'react';
import { usePageRecord, viewKey } from './PageContextProvider';

/**
 * Declare the record this page is about for as long as the component is
 * mounted; cleared on unmount so the next page starts clean. Idempotent on
 * re-renders with an equal ref.
 * @param record - The page's record, or null to declare none.
 */
export function useRecordContext(record: RecordRef | null): void {
  const { setRecord } = usePageRecord();
  const key = record ? `${record.type}|${record.id}|${record.label ?? ''}|${record.href ?? ''}` : '';
  useEffect(() => {
    setRecord(record);
    return () => setRecord(null);
    // `key` captures every field that matters; the object identity does not.
  }, [key, setRecord]);
}

/**
 * Declare what this page shows — its name and a few label/value pairs — for
 * as long as the component is mounted; cleared on unmount.
 * @param view - The page's view, or null.
 */
export function usePageView(view: PageView | null): void {
  const { setView } = usePageRecord();
  const key = viewKey(view);
  useEffect(() => {
    setView(view);
    return () => setView(null);
    // `key` captures every field that matters; the object identity does not.
  }, [key, setView]);
}
