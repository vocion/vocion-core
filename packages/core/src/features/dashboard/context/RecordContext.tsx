'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { useRecordContext } from './useRecordContext';

/**
 * Server-component-friendly way to declare a page's record: render this once
 * anywhere in the page tree. Renders nothing.
 * @param props
 * @param props.record
 */
export function RecordContext(props: { record: RecordRef }) {
  useRecordContext(props.record);
  return null;
}
