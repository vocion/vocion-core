'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { useEffect } from 'react';
import { usePageRecord } from './PageContextProvider';

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
