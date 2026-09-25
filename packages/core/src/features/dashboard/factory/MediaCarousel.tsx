'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** One picture on a feature page, with what it is for in the reader's words. */
export type MediaSlide = {
  id: number;
  src: string;
  /** Proposed, Today, After… */
  label: string;
  title: string;
  caption: string | null;
};

/**
 * WHAT IT LOOKS LIKE, as one picture at a time you can swipe (Chris,
 * 2026-09-25: "make it a clickable carousel? maybe click to zoom, too? think
 * about mobile first").
 *
 * It replaces one cropped hero over a strip of 160px thumbnails, where a flow
 * diagram was cut off at its top 440px and a phone screenshot filled the box
 * with its status bar. Now every picture is drawn whole (contained, not
 * cropped), a thumb swipes between them on native scroll snap, and a tap opens
 * it full screen where a second tap zooms and a finger pans.
 *
 * Native scrolling carries the swipe, so momentum, rubber-banding and a
 * trackpad all behave the way the platform does; the index is read back from
 * the scroll position rather than driving it.
 * @param props
 * @param props.slides - The pictures, in the order the page ranked them.
 */
export function MediaCarousel({ slides }: { slides: MediaSlide[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const go = useCallback((to: number) => {
    const el = strip.current;
    if (!el) {
      return;
    }
    const next = Math.max(0, Math.min(slides.length - 1, to));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  }, [slides.length]);

  const onScroll = () => {
    const el = strip.current;
    if (el && el.clientWidth > 0) {
      setIdx(Math.round(el.scrollLeft / el.clientWidth));
    }
  };

  if (slides.length === 0) {
    return null;
  }
  const current = slides[Math.min(idx, slides.length - 1)]!;
  const many = slides.length > 1;

  return (
    <div data-testid="report-carousel" className="space-y-2">
      <div className="group relative">
        <div
          ref={strip}
          onScroll={onScroll}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Open ${s.title} full screen`}
              data-testid="report-slide"
              className="flex aspect-[4/3] w-full shrink-0 snap-center items-center justify-center p-2 sm:aspect-[16/10]"
            >
              <img src={s.src} alt={s.caption ?? s.title} loading={i === 0 ? 'eager' : 'lazy'} className="max-h-full max-w-full rounded-md object-contain" />
            </button>
          ))}
        </div>
        {many && (
          <>
            <ArrowButton side="left" disabled={idx === 0} onClick={() => go(idx - 1)} />
            <ArrowButton side="right" disabled={idx >= slides.length - 1} onClick={() => go(idx + 1)} />
          </>
        )}
      </div>
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[13px] leading-snug">
          <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{current.label}</span>
          <span className="text-foreground">{current.title}</span>
          {current.caption && <span className="block text-muted-foreground">{current.caption}</span>}
        </p>
        {many && (
          <div className="flex shrink-0 items-center gap-1.5 pt-1" role="tablist" aria-label="Pictures">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Picture ${i + 1} of ${slides.length}: ${s.title}`}
                onClick={() => go(i)}
                className="flex size-6 items-center justify-center"
              >
                <span className={`block rounded-full transition-all ${i === idx ? 'h-2 w-4 bg-foreground' : 'size-2 bg-muted-foreground/40'}`} />
              </button>
            ))}
          </div>
        )}
      </div>
      {open !== null && (
        <Lightbox
          slides={slides}
          start={open}
          onClose={(at) => {
            setOpen(null);
            go(at);
          }}
        />
      )}
    </div>
  );
}

function ArrowButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={side === 'left' ? 'Previous picture' : 'Next picture'}
          className={`absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm transition-opacity group-hover:opacity-100 disabled:!opacity-0 sm:flex sm:opacity-0 ${side === 'left' ? 'left-2' : 'right-2'}`}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{side === 'left' ? 'Previous' : 'Next'}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Full screen, one picture at a time. Swipe or arrow keys between them; tap
 * (or click) the picture to zoom to its natural size and pan with a finger or
 * the scroll wheel; tap again to fit. Escape or the one close button leaves,
 * landing the page's carousel on the picture you were looking at.
 * @param props
 * @param props.slides - The pictures.
 * @param props.start - Which one opened.
 * @param props.onClose - Called with the index being viewed.
 */
function Lightbox({ slides, start, onClose }: { slides: MediaSlide[]; start: number; onClose: (at: number) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(start);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    const el = strip.current;
    if (el) {
      el.scrollLeft = start * el.clientWidth;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [start]);

  const go = useCallback((to: number) => {
    const el = strip.current;
    if (!el) {
      return;
    }
    setZoomed(false);
    el.scrollTo({ left: Math.max(0, Math.min(slides.length - 1, to)) * el.clientWidth, behavior: 'smooth' });
  }, [slides.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose(idx);
      } else if (e.key === 'ArrowRight') {
        go(idx + 1);
      } else if (e.key === 'ArrowLeft') {
        go(idx - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, go, onClose]);

  const current = slides[idx]!;
  return (
    <div role="dialog" aria-modal="true" aria-label={current.title} data-testid="report-lightbox" className="fixed inset-0 z-50 flex flex-col bg-black/95 text-white">
      <div className="flex h-14 shrink-0 items-center gap-3 px-3 pt-[env(safe-area-inset-top)]">
        <span className="font-mono text-xs tabular-nums opacity-70">{`${idx + 1} / ${slides.length}`}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{current.title}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => onClose(idx)} aria-label="Close" className="flex size-10 items-center justify-center rounded-full hover:bg-white/10">
              <X className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close (Esc)</TooltipContent>
        </Tooltip>
      </div>
      <div
        ref={strip}
        onScroll={() => {
          const el = strip.current;
          if (el && el.clientWidth > 0) {
            const next = Math.round(el.scrollLeft / el.clientWidth);
            if (next !== idx) {
              setIdx(next);
              setZoomed(false);
            }
          }
        }}
        className={`flex min-h-0 flex-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${zoomed ? 'overflow-x-hidden' : 'overflow-x-auto'}`}
      >
        {slides.map((s, i) => (
          <div key={s.id} className={`h-full w-full shrink-0 snap-center ${i === idx && zoomed ? 'touch-pan-x touch-pan-y overflow-auto' : 'flex items-center justify-center overflow-hidden p-2'}`}>
            <button
              type="button"
              onClick={() => setZoomed(z => !z)}
              aria-label={i === idx && zoomed ? 'Fit to screen' : 'Zoom in'}
              className={i === idx && zoomed ? 'block cursor-zoom-out' : 'flex max-h-full max-w-full cursor-zoom-in items-center justify-center'}
              style={i === idx && zoomed ? { width: 'max(200%, 100%)' } : { height: '100%' }}
            >
              <img
                src={s.src}
                alt={s.caption ?? s.title}
                data-testid={i === idx ? 'report-lightbox-image' : undefined}
                className={i === idx && zoomed ? 'block h-auto w-full max-w-none' : 'max-h-full max-w-full object-contain'}
              />
            </button>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] text-center text-[13px] leading-snug">
        <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] uppercase opacity-60">{current.label}</span>
        {current.caption ?? current.title}
        <span className="mt-1 block text-[11px] opacity-50">{zoomed ? 'Tap to fit' : 'Tap to zoom · swipe for the next'}</span>
      </div>
    </div>
  );
}
