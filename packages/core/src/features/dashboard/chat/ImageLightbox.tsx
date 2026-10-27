'use client';

import { ArrowUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/**
 * An attached picture opens over the conversation, not in a new tab (Jamie,
 * 2026-10-26: "it should be an in-place popover"). The thumbnail is the
 * trigger; the picture fills the screen it can; Esc, the ×, or a click
 * outside puts it down, and the original is one link away.
 * @param props
 * @param props.url - The authenticated artifact URL.
 * @param props.title - The file's name.
 */
export function ImageLightbox({ url, title }: { url: string; title: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block cursor-zoom-in overflow-hidden rounded-lg border border-border" title={title} aria-label={`View ${title}`} data-testid="message-image">
          {/* A plain img: the route is authenticated and same-origin, not a static asset for next/image. */}
          <img src={url} alt={title} className="max-h-40 max-w-60 object-cover" />
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col gap-3 p-3 sm:max-w-5xl" data-testid="message-image-lightbox">
        <img src={url} alt={title} className="max-h-[calc(100dvh-7rem)] min-h-0 w-full rounded-md object-contain" />
        <div className="flex items-center justify-between gap-3 pr-8 text-xs text-muted-foreground">
          <DialogTitle className="truncate text-xs font-normal text-muted-foreground">{title}</DialogTitle>
          <DialogDescription asChild>
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 hover:text-foreground hover:underline">
              Open original
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </DialogDescription>
        </div>
      </DialogContent>
    </Dialog>
  );
}
