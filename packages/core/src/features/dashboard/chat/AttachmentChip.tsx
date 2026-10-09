'use client';

import type { AttachmentFamily } from '@/libs/chat/attachmentFormats';
import { FileSpreadsheet, FileText, Mail, Presentation, X } from 'lucide-react';
import { formatBytes, formatOf } from '@/libs/chat/attachmentFormats';

const ICON: Partial<Record<AttachmentFamily, typeof FileText>> = {
  sheet: FileSpreadsheet,
  slides: Presentation,
  mail: Mail,
};

/**
 * The small line under a chip's name: what the file is, in words, and its
 * size — "Excel spreadsheet · 1.2 MB". Never a MIME type.
 * @param name - The file's name.
 * @param bytes - Its size.
 */
export function attachmentMeta(name: string, bytes: number): string {
  const label = formatOf({ name })?.label;
  return [label, bytes > 0 ? formatBytes(bytes) : ''].filter(Boolean).join(' · ');
}

/**
 * One file in the composer: an image shows itself, anything else its kind's
 * icon; the name, a line saying what it is, and an ×. While it is still going
 * up, a thin bar along the bottom fills with the bytes sent.
 * @param props
 * @param props.name - The file's name.
 * @param props.meta - The second line: kind and size, or the upload's state.
 * @param props.thumb - An image's URL, for a thumbnail.
 * @param props.progress - 0–1 while uploading; absent once the file is attached.
 * @param props.onRemove - The ×. Absent = no ×.
 * @param props.removeLabel - The ×'s accessible name.
 * @param props.testId - For tests.
 */
export function AttachmentChip({ name, meta, thumb, progress, onRemove, removeLabel, testId }: {
  name: string;
  meta?: string;
  thumb?: string;
  progress?: number;
  onRemove?: () => void;
  removeLabel?: string;
  testId?: string;
}) {
  const Icon = ICON[formatOf({ name })?.family ?? 'text'] ?? FileText;
  const pending = progress !== undefined;
  return (
    <span
      data-testid={testId}
      data-pending={pending || undefined}
      className="relative inline-flex max-w-full items-center gap-2 overflow-hidden rounded-lg border border-border bg-muted/40 py-1 pr-1 pl-1.5 text-xs sm:max-w-72"
    >
      {thumb
        ? <img src={thumb} alt="" className="size-7 shrink-0 rounded object-cover" />
        : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-foreground">{name}</span>
        {meta && <span className="truncate text-[10px] text-muted-foreground">{meta}</span>}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel ?? `Remove ${name}`} className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <X className="size-3" aria-hidden />
        </button>
      )}
      {pending && (
        <span
          role="progressbar"
          aria-label={`Uploading ${name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground/5"
        >
          <span
            className={`block h-full bg-brand-amber transition-[width] duration-200 ${progress >= 1 ? 'animate-pulse' : ''}`}
            style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}
          />
        </span>
      )}
    </span>
  );
}
