'use client';

import type { ChatAttachment } from './types';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * User message bubble (Phase C).
 *
 * Right-aligned soft-bordered bubble, preserved whitespace. No avatar,
 * no "You" label — right alignment IS the identity ("insert quarter,
 * shoot aliens": the transcript needs no decoration to be read).
 *
 * Long content — a message that carried pasted material — clamps to a
 * readable height with its own expand, so the instruction stays the thing
 * the transcript shows (032 §2.1 rule 5).
 */

export type UserMessageProps = {
  content: string;
  /** Files the person attached — an image thumbnail or a named document, above the text. */
  attachments?: ChatAttachment[];
};

/** Messages longer than this clamp behind a Show more control. */
const CLAMP_THRESHOLD = 600;

export function UserMessage({ content, attachments = [] }: UserMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const long = content.length > CLAMP_THRESHOLD;
  return (
    <div className="flex justify-end">
      <div className="max-w-2xl rounded-2xl border border-border bg-muted/40 px-4 py-2 text-left text-sm whitespace-pre-wrap">
        {/* What was attached is part of what was said: an image shows itself,
            a document shows its name. Each opens the artifact (authenticated). */}
        {attachments.length > 0 && (
          <div data-testid="message-attachments" className="mb-2 flex flex-wrap gap-2">
            {attachments.map(a => (a.kind === 'image'
              ? (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-border" title={a.title}>
                    {/* A plain img: the route is authenticated and same-origin, not a static asset for next/image. */}
                    <img src={a.url} alt={a.title} className="max-h-40 max-w-60 object-cover" />
                  </a>
                )
              : (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="inline-flex max-w-72 items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground/85 no-underline transition hover:border-brand-amber/40">
                    {a.contentType.startsWith('image/') ? <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="truncate">{a.title}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(a.bytes)}</span>
                  </a>
                )))}
          </div>
        )}
        {long && !expanded ? `${content.slice(0, CLAMP_THRESHOLD)}…` : content}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="mt-1 block text-xs font-medium text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "12 KB", "3.4 MB" — a size a person reads, never a byte count.
 * @param n - Bytes.
 */
export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
