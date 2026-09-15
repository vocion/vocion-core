'use client';

/**
 * One artifact on the canvas: a title bar (drag handle, kind, span control,
 * expand, close) over the card on the `canvas` surface. Close = unpin (the
 * artifact stays in the conversation; "Hidden · n" brings it back).
 */

import type { Span } from './canvasReducer';
import type { ArtifactPayload } from '@/services/agents/types';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Maximize2, X } from 'lucide-react';
import { cn } from '@/utils/Helpers';
import { ArtifactCard } from './ArtifactCard';

const KIND_LABEL: Record<ArtifactPayload['kind'], string> = {
  table: 'Table',
  markdown: 'Note',
  chart: 'Chart',
  record: 'Record',
  link: 'Link',
  file: 'File',
};

export function ArtifactTile({ artifact, span, onSpan, onClose, onExpand }: {
  artifact: ArtifactPayload;
  span: Span;
  onSpan: (span: Span) => void;
  onClose: () => void;
  onExpand: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: artifact.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <section
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex min-h-36 min-w-0 flex-col rounded-lg border border-border bg-background',
        span === 2 && 'md:col-span-2',
        span === 3 && 'md:col-span-3',
        isDragging && 'z-10 shadow-lg ring-1 ring-foreground/20',
      )}
      aria-label={artifact.title}
    >
      <header className="flex items-center gap-1.5 border-b border-border/70 px-2 py-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="size-3.5" />
        </button>
        <span className="truncate text-xs font-medium text-foreground">{artifact.title}</span>
        <span className="ml-1 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">{KIND_LABEL[artifact.kind]}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <span className="mr-1 hidden items-center rounded border border-border text-[10px] md:inline-flex" role="group" aria-label="Tile width">
            {([1, 2, 3] as Span[]).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => onSpan(s)}
                className={cn('px-1.5 py-0.5 text-muted-foreground hover:text-foreground', s === span && 'bg-muted text-foreground')}
                aria-pressed={s === span}
                aria-label={`${s} column${s > 1 ? 's' : ''}`}
              >
                {s}
              </button>
            ))}
          </span>
          <button type="button" onClick={onExpand} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Expand">
            <Maximize2 className="size-3.5" />
          </button>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Hide from canvas">
            <X className="size-3.5" />
          </button>
        </span>
      </header>
      <div className="min-w-0 flex-1 overflow-auto p-3">
        <ArtifactCard artifact={artifact} surface="canvas" />
      </div>
    </section>
  );
}
