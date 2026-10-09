'use client';

import type { ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ATTACHMENT_HINT, formatBytes, MAX_UPLOAD_BYTES } from '@/libs/chat/attachmentFormats';

/**
 * The whole conversation is the drop target.
 *
 * A file held anywhere over the chat — the transcript, the empty state, the
 * composer — shows one calm overlay across the pane, "Drop to attach", and
 * letting go puts the files in the composer as chips (founder, 2026-10-09:
 * "chat should have a much bigger file drop zone"). The composer's own box is
 * inside this pane, so there is one drop target and one way a drop lands,
 * whichever chat surface hosts it: the full page and the rail both wrap their
 * pane in this.
 *
 * Only a drag carrying FILES lights it: dragging a selection of text or a
 * link within the page is not an attach. On a phone there is no drag, and
 * the composer's + is the path.
 * @param props
 * @param props.onFiles - The files dropped. Absent = attaching is off, and the pane is inert.
 * @param props.className - The pane's own layout classes; the zone is the pane.
 * @param props.children - The pane.
 */
export function ChatDropZone({ onFiles, className, children }: { onFiles?: (files: File[]) => void; className?: string; children: ReactNode }) {
  // A counter, not a flag: enter and leave fire for every child the pointer crosses.
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  // A drag that ends outside the window (or is cancelled with Esc) never
  // fires a leave on the pane; any drop or dragend anywhere clears it.
  useEffect(() => {
    if (!over) {
      return;
    }
    const reset = () => {
      depth.current = 0;
      setOver(false);
    };
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
    };
  }, [over]);

  const carriesFiles = (e: React.DragEvent) => Boolean(onFiles) && Array.from(e.dataTransfer?.types ?? []).includes('Files');

  return (
    <div
      className={`relative ${className ?? ''}`}
      data-testid="chat-drop-zone"
      onDragEnter={(e) => {
        if (!carriesFiles(e)) {
          return;
        }
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!carriesFiles(e)) {
          return;
        }
        // Without this the browser opens the file instead of dropping it here.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!carriesFiles(e)) {
          return;
        }
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setOver(false);
        }
      }}
      onDrop={(e) => {
        if (!carriesFiles(e)) {
          return;
        }
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []).filter(f => f.size > 0 || f.type !== '');
        if (files.length > 0) {
          onFiles?.(files);
        }
      }}
    >
      {children}
      {over && (
        <div
          data-testid="chat-drop-overlay"
          aria-hidden
          // Calm: a soft veil and a dashed hairline, no shadow. Pointer events
          // off so the drag keeps reaching the pane underneath.
          className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-amber/50 bg-background/90 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in-0"
        >
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
              <Paperclip className="size-5" aria-hidden />
            </span>
            <span className="text-base font-medium text-foreground">Drop to attach</span>
            <span className="text-xs text-muted-foreground">
              {`${ATTACHMENT_HINT} · up to ${formatBytes(MAX_UPLOAD_BYTES)} each`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
