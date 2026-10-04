'use client';

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { EvidenceSource } from '@/services/factory/carouselSource';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePreviewOpener } from '@/features/preview/previewState';

/** One picture on a feature page, with what it is for in the reader's words. */
export type MediaSlide = {
  id: number;
  src: string;
  /** Its section: Mockup, Today, Plan, QA before, QA after, Live, Reported in chat. */
  label: string;
  title: string;
  /** What it shows, one line — written when it was filed. The title stands in when there is none. */
  caption: string | null;
  /** Who or what made it and when, linked to where it came from. */
  source?: EvidenceSource | null;
  /**
   * A picture (the default) or a recording Vocion serves (`type` is its
   * content type). A recording opens full screen and plays there; a picture
   * opens zoomable.
   */
  kind?: 'image' | 'video';
  /** The recording's content type, for `kind: 'video'`. */
  type?: string;
};

/**
 * What a slide shows in the strip before it is opened: the picture, or the
 * recording's first frame under a play mark — it plays once opened.
 * @param props
 * @param props.slide - The slide.
 * @param props.eager - Load it now (the first slide).
 */
function SlidePreview({ slide, eager }: { slide: MediaSlide; eager: boolean }) {
  const alt = slide.caption ?? slide.title;
  if (slide.kind === 'video') {
    return (
      <span className="relative flex size-full items-center justify-center overflow-hidden rounded-md bg-[#09090b]" data-testid="report-slide-video">
        {/* The first frame stands for the recording; it plays full screen. */}
        { }
        <video src={`${slide.src}#t=0.1`} muted playsInline preload="metadata" aria-hidden className="max-h-full max-w-full object-contain" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/90 text-[#09090b] shadow-md">
            <Play className="size-6 translate-x-0.5 fill-current" aria-hidden />
          </span>
        </span>
      </span>
    );
  }
  return <img src={slide.src} alt={alt} loading={eager ? 'eager' : 'lazy'} className="max-h-full max-w-full rounded-md object-contain" />;
}

/**
 * A recording or a player, full screen: it plays with its own controls (the
 * player's own full-screen button included) while it is the slide in view.
 * @param props
 * @param props.slide - The slide.
 * @param props.inView - Whether it is the slide being looked at; one out of view is not loaded.
 */
function SlidePlayer({ slide, inView }: { slide: MediaSlide; inView: boolean }) {
  const label = `${slide.label}: ${slide.caption ?? slide.title}`;
  if (!inView) {
    return <span className="size-full" aria-hidden />;
  }
  return (
    // A browser recording has no sound to caption; what it shows is the caption below.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video controls autoPlay playsInline preload="auto" aria-label={label} className="max-h-full max-w-full rounded-md bg-black object-contain" data-testid="report-lightbox-video">
      <source src={slide.src} {...(slide.type ? { type: slide.type } : {})} />
    </video>
  );
}

/**
 * WHO MADE IT, WHEN — the picture's source line. It opens where the picture
 * came from (the run, the conversation, the release) in the preview pane, the
 * one place every peek opens.
 * @param props
 * @param props.source - The source.
 * @param props.tone - On the page, or on the dark lightbox.
 * @param props.onOpen - Called before the pane opens (the lightbox closes itself).
 */
function SourceLine({ source, tone = 'page', onOpen }: { source: EvidenceSource; tone?: 'page' | 'dark'; onOpen?: () => void }) {
  const open = usePreviewOpener(source.ref ?? { type: 'artifact', id: '0' });
  const cls = tone === 'dark' ? 'text-[12px] text-white/60' : 'text-[12px] text-muted-foreground';
  if (!source.ref) {
    return <span data-testid="report-slide-source" className={`block ${cls}`}>{source.text}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="report-slide-source"
          onClick={(e) => {
            onOpen?.();
            open(e);
          }}
          className={`block max-w-full truncate text-left underline-offset-2 hover:underline ${cls} ${tone === 'dark' ? 'hover:text-white' : 'hover:text-foreground'}`}
        >
          {source.text}
        </button>
      </TooltipTrigger>
      <TooltipContent>Open where it came from</TooltipContent>
    </Tooltip>
  );
}

/**
 * The words under a picture: its section, what it shows, and who made it when.
 * @param props
 * @param props.slide - The picture.
 */
function SlideCaption({ slide }: { slide: MediaSlide }) {
  return (
    <p className="min-w-0 flex-1 text-[13px] leading-snug" data-testid="report-slide-caption">
      <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase" data-testid="report-slide-section">{slide.label}</span>
      <span className="text-foreground">{slide.caption ?? slide.title}</span>
      {slide.source && <SourceLine source={slide.source} />}
    </p>
  );
}

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
  const thumbs = useRef<HTMLDivElement>(null);
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

  // The thumbnail in view stays in view as the index moves, without
  // scrolling the page.
  useEffect(() => {
    const t = thumbs.current?.children[idx] as HTMLElement | undefined;
    const row = thumbs.current;
    if (t && row) {
      const left = t.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + t.offsetWidth > row.scrollLeft + row.clientWidth) {
        row.scrollTo({ left: left - (row.clientWidth - t.offsetWidth) / 2, behavior: 'smooth' });
      }
    }
  }, [idx]);

  // Left and right arrows move the index (Chris, 2026-10-03: "should advance
  // index, not scroll the thumbnails"), from anywhere inside the carousel —
  // a focused thumbnail hands focus to the new one.
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      return;
    }
    e.preventDefault();
    const to = Math.max(0, Math.min(slides.length - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)));
    go(to);
    if (thumbs.current?.contains(document.activeElement)) {
      (thumbs.current.children[to] as HTMLElement | undefined)?.focus({ preventScroll: true });
    }
  };

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
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- arrow keys from the slides and thumbnails inside
    <div data-testid="report-carousel" className="space-y-2" onKeyDown={onKeyDown}>
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
              // The page itself never zooms (layout.tsx), so a pinch here opens
              // the picture full screen, where it pinches.
              onTouchStart={(e) => {
                if (e.touches.length >= 2) {
                  setOpen(i);
                }
              }}
              aria-label={`${s.kind === 'video' ? 'Play' : 'Open'} ${s.caption ?? s.title} full screen`}
              data-testid="report-slide"
              className="flex aspect-[4/3] w-full shrink-0 snap-center items-center justify-center p-2 sm:aspect-[16/10]"
            >
              <SlidePreview slide={s} eager={i === 0} />
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
        <SlideCaption slide={current} />
        {many && <span className="shrink-0 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{`${idx + 1} / ${slides.length}`}</span>}
      </div>
      {/* THUMBNAILS (Chris, 2026-09-25: "show thumbnails on the gallery"):
          every picture at a glance, the one in view outlined, a tap goes to it. */}
      {many && (
        <div ref={thumbs} className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Pictures" data-testid="report-thumbs">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === idx}
              tabIndex={i === idx ? 0 : -1}
              aria-label={`Picture ${i + 1} of ${slides.length}: ${s.label} — ${s.caption ?? s.title}`}
              onClick={() => go(i)}
              className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border bg-muted transition sm:h-16 sm:w-24 ${i === idx ? 'border-foreground ring-1 ring-foreground' : 'border-border opacity-70 hover:opacity-100'}`}
            >
              {s.kind === 'video'
                ? <span className="flex size-full items-center justify-center bg-[#09090b] text-white"><Play className="size-4 fill-current" aria-hidden /></span>
                : <img src={s.src} alt="" loading="lazy" className="size-full object-cover object-top" />}
            </button>
          ))}
        </div>
      )}
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
 * Full screen, one picture at a time. Swipe or arrow keys between them;
 * pinch (or tap, or a trackpad pinch) to zoom, drag to look around while
 * zoomed, tap again to fit. Escape or the one close button leaves,
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
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={current.caption ?? current.title} data-testid="report-lightbox" className="fixed inset-0 z-[100] flex flex-col bg-[#09090b] text-white">
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
          <div key={s.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center overflow-hidden p-2">
            {s.kind === 'video'
              ? <SlidePlayer slide={s} inView={i === idx} />
              : (
                  <ZoomableImage
                    // Remounted when it leaves view, so the next visit opens fitted.
                    key={i === idx ? 'in-view' : 'out'}
                    src={s.src}
                    alt={s.caption ?? s.title}
                    testId={i === idx ? 'report-lightbox-image' : undefined}
                    onZoomChange={z => i === idx && setZoomed(z)}
                  />
                )}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col items-center px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] text-center text-[13px] leading-snug" data-testid="report-lightbox-caption">
        <span>
          <span className="mr-2 text-[11px] font-semibold tracking-[0.08em] uppercase opacity-60">{current.label}</span>
          {current.caption ?? current.title}
        </span>
        {current.source && <SourceLine source={current.source} tone="dark" onOpen={() => onClose(idx)} />}
        <span className="mt-1 block text-[11px] opacity-50">{current.kind === 'video' ? (slides.length > 1 ? 'Swipe for the next' : '') : zoomed ? 'Pinch or tap to fit · drag to look around' : 'Pinch or tap to zoom · swipe for the next'}</span>
      </div>
    </div>,
    document.body,
  );
}

const MAX_ZOOM = 5;
const TAP_ZOOM = 2.5;

/**
 * A picture that pinches (Chris, 2026-10-02: "enable pinch zoom on the
 * images", mobile). The app turns browser zoom off (layout.tsx), so the
 * gesture is ours: two fingers scale about their midpoint, one finger pans
 * while zoomed, a tap toggles fit and 2.5x, a trackpad pinch (ctrl + wheel)
 * zooms on desktop. At 1x the strip still swipes between pictures.
 * @param props
 * @param props.src - The image.
 * @param props.alt - Its description.
 * @param props.testId - Test id for the image.
 * @param props.onZoomChange - Called with whether it is zoomed past 1x.
 */
function ZoomableImage({ src, alt, testId, onZoomChange }: { src: string; alt: string; testId?: string; onZoomChange: (zoomed: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const gesture = useRef<{ kind: 'pinch' | 'pan' | null; dist: number; scale: number; x: number; y: number; mx: number; my: number; moved: boolean }>({ kind: null, dist: 0, scale: 1, x: 0, y: 0, mx: 0, my: 0, moved: false });
  const zoomed = view.scale > 1.01;
  // While fingers are down the picture follows them; once they lift it eases.
  const [touching, setTouching] = useState(false);

  useEffect(() => {
    onZoomChange(zoomed);
  }, [zoomed, onZoomChange]);

  const clampTo = useCallback((scale: number, x: number, y: number) => {
    const el = box.current;
    const s = Math.max(1, Math.min(MAX_ZOOM, scale));
    if (!el || s <= 1.01) {
      return { scale: 1, x: 0, y: 0 };
    }
    const mx = (el.clientWidth * (s - 1)) / 2;
    const my = (el.clientHeight * (s - 1)) / 2;
    return { scale: s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) {
      return undefined;
    }
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent) => {
      const g = gesture.current;
      setTouching(true);
      setView((v) => {
        if (e.touches.length >= 2) {
          g.kind = 'pinch';
          g.dist = dist(e.touches);
          g.scale = v.scale;
          g.x = v.x;
          g.y = v.y;
          const r = el.getBoundingClientRect();
          g.mx = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - (r.left + r.width / 2);
          g.my = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - (r.top + r.height / 2);
        } else if (v.scale > 1.01) {
          g.kind = 'pan';
          g.mx = e.touches[0]!.clientX;
          g.my = e.touches[0]!.clientY;
          g.x = v.x;
          g.y = v.y;
        } else {
          g.kind = null;
        }
        g.moved = false;
        return v;
      });
    };
    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (g.kind === 'pinch' && e.touches.length >= 2) {
        e.preventDefault();
        g.moved = true;
        const scale = g.scale * (dist(e.touches) / (g.dist || 1));
        // Keep the point under the fingers where it was.
        const k = scale / g.scale;
        setView(clampTo(scale, g.mx - (g.mx - g.x) * k, g.my - (g.my - g.y) * k));
      } else if (g.kind === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        g.moved = true;
        setView(v => clampTo(v.scale, g.x + e.touches[0]!.clientX - g.mx, g.y + e.touches[0]!.clientY - g.my));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        gesture.current.kind = null;
        setTouching(false);
      }
    };
    const onWheel = (e: WheelEvent) => {
      // A trackpad pinch arrives as ctrl + wheel.
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      setView(v => clampTo(v.scale * Math.exp(-e.deltaY / 100), v.x, v.y));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('wheel', onWheel);
    };
  }, [clampTo]);

  return (
    <div ref={box} className={`relative flex h-full w-full items-center justify-center overflow-hidden ${zoomed ? 'touch-none' : 'touch-pan-x'}`}>
      <button
        type="button"
        onClick={() => {
          if (gesture.current.moved) {
            gesture.current.moved = false;
            return;
          }
          setView(v => (v.scale > 1.01 ? { scale: 1, x: 0, y: 0 } : clampTo(TAP_ZOOM, 0, 0)));
        }}
        aria-label={zoomed ? 'Fit to screen' : 'Zoom in'}
        className={`flex h-full max-h-full w-full max-w-full items-center justify-center ${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
      >
        <img
          src={src}
          alt={alt}
          data-testid={testId}
          draggable={false}
          className="max-h-full max-w-full object-contain select-none"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transition: touching ? 'none' : 'transform 150ms ease-out' }}
        />
      </button>
    </div>
  );
}
