'use client';

import type { RecordRef } from '@/services/chat/pageContext';
import { X } from 'lucide-react';

/**
 * "About: <record>" above the composer — the record the next turn is about,
 * on the full page (the rail draws the same chip inline). One shape for a
 * thing carried into a conversation, whatever page it came from.
 * @param props
 * @param props.record
 * @param props.onDrop - Ask without this record.
 */
export function AboutRecordChip({ record, onDrop }: { record: RecordRef; onDrop: () => void }) {
  const label = record.label ?? `${record.type.replace('_', ' ')} ${record.id}`;
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5" data-testid="about-record-chip">
      <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <span className="shrink-0">About:</span>
        <span className="truncate font-medium text-foreground/85">{label}</span>
        <button type="button" aria-label="Ask without this record" title="Ask without this record" onClick={onDrop} className="ml-0.5 shrink-0 rounded-full text-muted-foreground hover:text-foreground">
          <X className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  );
}
